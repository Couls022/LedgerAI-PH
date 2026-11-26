import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = typeof import.meta?.url === 'string' ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();

// INTERNAL LICENSE AUTHORITY SIGNER
// THIS FILE IS STRICTLY INTERNAL AND MUST NEVER BE BUNDLED INTO CLIENT RELEASES.

export const DEV_TEST_AUTHORITY_KEY_ID = 'LGR-AUTH-KEY-DEV-2026-V1';

// Development / Automated-Test Only Authority RSA Keypair
// WARNING: Committed in repository history; strictly prohibited for commercial production licensing.
const DEFAULT_AUTHORITY_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCLNsY9T/nfpgQ5
ATKyOEaN1HzeBHYDAkontb6MXuIHYQi9ik8+390yyqnCPFHy+xViDUhzqpJD3Iu9
VfHCVNeO8buxOYwTj5narNNxw7oQgRebYiPezY+E3pVd2pTCQMkl4zHdb399YV+8
nVBtipj0xNkSoYzrHffMER50MtbW87t9a6LdDH/CdojAUu8f4IKI/Px8ekqj0uO3
TgpGHWPOLTmCsbehx+Taf3DDg383hJ9hv2GnZZVC1bG8Sy4+gK5ZwD9Amia31Zvd
dUhGX6iHCHD0YOTYfmJszq8AmUC5QiQ4Do+5ATbnVsGnKodqrt8UXQzt9OSAMBeA
do6J/DatAgMBAAECggEAIFs9hbQgM1lai2ZKIm6ehWoBELgwNqBSXHrrPCR0e/sT
ZTxvkUFGX/8HKEhNUsCFdon4UDvxrXil+P5wB7cg984bDgS+WDCM9aysI3m2tg3P
DxQnGqqj5CG4zTzXzPNyXQ46gYlf9CQM9KGKtz8asG9NNb2bK22GceV7ss27Le/W
HDQD6vHU5dvTl0j2Agjo3tbYh+kknqknXiubTMgAVGeMWvnvw6sw+fJx8i6JqSGX
3NeNrJljTT3FNhGrVEdAHdeJIw02WsvE4tSkJW/QAgDnbSvWVxSG+3HmqaxiVL7F
3GZDx4RIhS3oCY72rQLaif+P85xQusynC6wM3w1cSQKBgQC/7q0ukzA3xLKH8Czb
cjf8Ozww+08PfJxyJ8WqnnkzafcS5u8oVZbhW1Z7U36IIpyxwqADh7yXz8vHCVuF
sJp8g09PIHwTLR5hd35un5rGgrrezAYXsTQCKnKQ74g4ha4zg4+JDlqnT2laDUtt
QRHRBtOOGOMeorq8PHrX9+uCyQKBgQC5rx6VyND+f2gj1fm6Zw9cVGNVD58guE1l
gltcvrliYS4VY8s4LOlEyZWfZADIcwfI8U2isycHBuEv6jGN0xPQN0KzGYtkKHV+
u0xswLTRHNRNDW43gqCc8HoBguIZlvtpXB8gHYApaTCbF6e2befvZ5SDTdpV2A6g
IPPrH2MCxQKBgQCZmAljQkrN9kzg2GUtYCRJZ6XtlM9aF2CjQgy/U36ulFgy+jfd
UVEjGxMEMncJvpki8BtZd+CGpLXwnB5vyDp49iQbsGVaezrayOOW54bW4XtmHGOr
xhVWvl1cezPJ98DGXLwa9C+7wKMQe58m2XHGku3twyDOPW+uf7/W4QHJcQKBgQCa
LlEFKrRvPjeo2fn8z6qvjdrVPJ1zO9X4Xd+jCTNB/1OWq0CJKrGfTouQyCbmSq3C
Kqu+V2gmq428jYgMLaKcF+aodKOLzRSS4M861mDN6lRWjrpgGXVoGz4TlyxK91VX
TQkDT7ulpxSXE3NNRcF6xtVImhKbiUXLrNEdAPjjyQKBgAlhhQxv2rnw3VRN3DJ4
EjvGqptWJPqTCaz53ayfMOWHwO5SCg07HCiKYwkJ9OCxfbmakrUM5/ny0IHlfiA2
emQqk4E0yqWk4aMSn3AjJE2pvGDR9XFgwlbrQ5Jg5YOZgNEq4G+F0NAiFA4K0g58
0Xv6I3s8qGCA/owRDDB061PA
-----END PRIVATE KEY-----`;

export interface AuthoritySigningAuditEntry {
  timestamp: string;
  keyId: string;
  keyVersion: number;
  environment: 'DEVELOPMENT_TEST_ONLY' | 'PRODUCTION';
  companyId: string;
  licenseId: string;
  action: 'SIGN_LICENSE' | 'REJECT_UNAUTHORIZED_SIGNING';
  reason?: string;
}

export class AuthoritySigner {
  private static cachedPrivateKey: string | null = null;
  private static cachedKeyId: string = DEV_TEST_AUTHORITY_KEY_ID;
  private static cachedKeyVersion: number = 1;
  private static auditHistory: AuthoritySigningAuditEntry[] = [];

  static clearCacheForTesting(): void {
    this.cachedPrivateKey = null;
    this.cachedKeyId = DEV_TEST_AUTHORITY_KEY_ID;
    this.cachedKeyVersion = 1;
  }

  static getKeyUsageAuditHistory(): AuthoritySigningAuditEntry[] {
    return [...this.auditHistory];
  }

  static getActiveKeyMetadata(): {
    keyId: string;
    keyVersion: number;
    environment: 'DEVELOPMENT_TEST_ONLY' | 'PRODUCTION';
  } {
    this.getPrivateKey();
    const isDevKey = this.cachedKeyId === DEV_TEST_AUTHORITY_KEY_ID;
    return {
      keyId: this.cachedKeyId,
      keyVersion: this.cachedKeyVersion,
      environment: isDevKey ? 'DEVELOPMENT_TEST_ONLY' : 'PRODUCTION',
    };
  }

  static getPrivateKey(): string {
    const enforceProdKey =
      process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY === 'true' ||
      process.env.LEDGERAI_AUTHORITY_MODE === 'PRODUCTION';

    let privateKey = process.env.LEDGERAI_AUTHORITY_PRIVATE_KEY || process.env.LICENSE_PRIVATE_KEY;
    let resolvedKeyId = process.env.LEDGERAI_AUTHORITY_KEY_ID || DEV_TEST_AUTHORITY_KEY_ID;
    let resolvedKeyVersion = Number(process.env.LEDGERAI_AUTHORITY_KEY_VERSION || 1);

    if (!privateKey) {
      const candidates = [
        path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'LedgerAI-PH-Authority', 'vault', 'keys.json'),
        'C:\\ProgramData\\LedgerAI PH\\Authority\\keys.json',
        path.resolve(__dirname, '../../internal/authority-keys/keys.json'),
        path.resolve(__dirname, '../authority-keys/keys.json'),
        path.resolve(process.cwd(), 'internal/authority-keys/keys.json'),
        path.resolve(process.cwd(), 'internal/authority-keys/authority_keys.json'),
        path.resolve(process.cwd(), 'tools/key-generator/keys.json'),
        path.resolve(__dirname, '../../tools/key-generator/keys.json'),
        path.resolve(process.cwd(), 'data/authority_keys.json'),
      ];

      for (const keysPath of candidates) {
        if (fs.existsSync(keysPath)) {
          try {
            const raw = fs.readFileSync(keysPath, 'utf8');
            const keys = JSON.parse(raw);
            if (keys && keys.privateKey) {
              privateKey = keys.privateKey;
              if (keys.keyId) resolvedKeyId = String(keys.keyId);
              if (keys.keyVersion) resolvedKeyVersion = Number(keys.keyVersion);
              break;
            }
          } catch {
            // Never log key file contents or sensitive details
            console.error(`[AuthoritySigner] Failed to parse authority key metadata at ${keysPath}`);
          }
        }
      }
    }

    const isUsingDefaultDevKey =
      !privateKey ||
      privateKey.trim() === DEFAULT_AUTHORITY_PRIVATE_KEY.trim() ||
      resolvedKeyId === DEV_TEST_AUTHORITY_KEY_ID;

    if (enforceProdKey && isUsingDefaultDevKey) {
      this.auditHistory.push({
        timestamp: new Date().toISOString(),
        keyId: DEV_TEST_AUTHORITY_KEY_ID,
        keyVersion: 1,
        environment: 'DEVELOPMENT_TEST_ONLY',
        companyId: 'N/A',
        licenseId: 'N/A',
        action: 'REJECT_UNAUTHORIZED_SIGNING',
        reason: 'Attempted to sign license in PRODUCTION mode using development/test key LGR-AUTH-KEY-DEV-2026-V1',
      });
      throw new Error(
        'PRODUCTION_SIGNING_KEY_REQUIRED: Refusing to sign with development/test authority key LGR-AUTH-KEY-DEV-2026-V1 when production key enforcement is active.'
      );
    }

    if (!privateKey) {
      privateKey = DEFAULT_AUTHORITY_PRIVATE_KEY;
      resolvedKeyId = DEV_TEST_AUTHORITY_KEY_ID;
      resolvedKeyVersion = 1;
    }

    this.cachedPrivateKey = privateKey;
    this.cachedKeyId = resolvedKeyId;
    this.cachedKeyVersion = resolvedKeyVersion;
    return privateKey;
  }

  /**
   * Signs a license payload using SHA256withRSA and the active Authority Private Key
   */
  static signLicense(licenseData: any): string {
    if (!licenseData || typeof licenseData !== 'object') {
      throw new Error('INVALID_LICENSE_PAYLOAD: License payload must be a valid non-null object.');
    }
    const privateKey = this.getPrivateKey();
    const revokedIds = (process.env.LEDGERAI_REVOKED_AUTHORITY_KEY_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const effectiveKeyId = licenseData.authorityKeyId || this.cachedKeyId;
    if (revokedIds.includes(effectiveKeyId)) {
      this.auditHistory.push({
        timestamp: new Date().toISOString(),
        keyId: effectiveKeyId,
        keyVersion: this.cachedKeyVersion,
        environment: effectiveKeyId === DEV_TEST_AUTHORITY_KEY_ID ? 'DEVELOPMENT_TEST_ONLY' : 'PRODUCTION',
        companyId: String(licenseData.companyId || 'UNKNOWN'),
        licenseId: String(licenseData.licenseId || 'UNKNOWN'),
        action: 'REJECT_UNAUTHORIZED_SIGNING',
        reason: `Signing key ${effectiveKeyId} is revoked`,
      });
      throw new Error(`REVOKED_SIGNING_KEY: Authority key ${effectiveKeyId} has been revoked and cannot sign new licenses.`);
    }

    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(licenseData));
    sign.end();
    const signature = sign.sign(privateKey, 'base64');

    this.auditHistory.push({
      timestamp: new Date().toISOString(),
      keyId: effectiveKeyId,
      keyVersion: Number(licenseData.authorityKeyVersion || this.cachedKeyVersion),
      environment: effectiveKeyId === DEV_TEST_AUTHORITY_KEY_ID ? 'DEVELOPMENT_TEST_ONLY' : 'PRODUCTION',
      companyId: String(licenseData.companyId || 'UNKNOWN'),
      licenseId: String(licenseData.licenseId || 'UNKNOWN'),
      action: 'SIGN_LICENSE',
    });

    return signature;
  }

  /**
   * Signs a license payload with an explicitly provided rotated keypair (for key rotation testing / HSM delegation)
   */
  static signLicenseWithCustomKey(
    licenseData: any,
    options: { privateKeyPem: string; keyId: string; keyVersion: number }
  ): { signedPayload: any; signature: string } {
    const signedPayload = {
      ...licenseData,
      authorityKeyId: options.keyId,
      authorityKeyVersion: options.keyVersion,
    };
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(signedPayload));
    sign.end();
    const signature = sign.sign(options.privateKeyPem, 'base64');

    this.auditHistory.push({
      timestamp: new Date().toISOString(),
      keyId: options.keyId,
      keyVersion: options.keyVersion,
      environment: options.keyId === DEV_TEST_AUTHORITY_KEY_ID ? 'DEVELOPMENT_TEST_ONLY' : 'PRODUCTION',
      companyId: String(licenseData.companyId || 'UNKNOWN'),
      licenseId: String(licenseData.licenseId || 'UNKNOWN'),
      action: 'SIGN_LICENSE',
    });

    return { signedPayload, signature };
  }

  /**
   * Generates a complete signed .lai license artifact and compact transferable key token
   */
  static generateSignedLicenseArtifact(payload: any): {
    payload: any;
    signature: string;
    json: string;
    compactToken: string;
  } {
    const signature = this.signLicense(payload);
    const artifact = { payload, signature };
    const json = JSON.stringify(artifact, null, 2);

    const container = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
    const compactToken = `LGR-${payload.planType || 'PRO'}-${container}`;

    return {
      payload,
      signature,
      json,
      compactToken,
    };
  }

  /**
   * Generates a cryptographically linked, dual-file license pair:
   * File A (.lkey): License Key File containing authorized key identity & pair digest
   * File B (.lai):  Key License File containing signed license authorization, entitlements & company binding
   */
  static generateSignedLicensePair(params: {
    licenseId?: string;
    licensePairId?: string;
    keyFileId?: string;
    companyId: string;
    activationKey: string;
    planType: 'PRO' | 'ENTERPRISE' | string;
    type: 'TERM' | 'LIFETIME' | string;
    durationType?: string;
    expirationDate: string | null;
    seatCount: number | 'UNLIMITED';
    deviceBindingHash?: string | null;
    issuedAt?: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
    recoveryReference?: string | null;
    recoveryReason?: string | null;
  }) {
    const keyMeta = this.getActiveKeyMetadata();
    const licensePairId = params.licensePairId || `PAIR-${crypto.randomUUID()}`;
    const licenseId = params.licenseId || crypto.randomUUID();
    const keyFileId = params.keyFileId || `KEYF-${crypto.randomUUID()}`;
    const issuedAt = params.issuedAt || new Date().toISOString();
    const revocationRef = `rev-${licensePairId}`;

    const canonical = [
      licensePairId.trim(),
      licenseId.trim(),
      keyFileId.trim(),
      params.companyId.trim(),
      String(params.planType || 'PRO').trim().toUpperCase(),
      params.expirationDate ? String(params.expirationDate).trim() : 'LIFETIME',
      issuedAt.trim(),
    ].join('|');
    const pairDigest = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

    const entitlements = {
      planType: params.planType,
      seatCount: params.seatCount,
      features:
        params.planType === 'ENTERPRISE'
          ? ['ALL_MODULES', 'UNLIMITED_SEATS', 'MULTI_BRANCH', 'AUDIT_WORKPAPERS', 'AI_ENTERPRISE']
          : ['ALL_MODULES', 'PRO_SEAT_LIMIT', 'BIR_COMPLIANCE', 'AI_ASSISTANT'],
    };

    const licenseKeyFilePayload = {
      artifactType: 'LEDGERAI_LICENSE_KEY_FILE' as const,
      licensePairId,
      licenseId,
      keyFileId,
      companyId: params.companyId.trim(),
      activationKey: params.activationKey,
      planType: params.planType,
      type: params.type,
      expirationDate: params.expirationDate,
      issuedAt,
      issuerIdentity: 'LEDGERAI-PH-AUTHORITY',
      licenseVersion: '2.0',
      activationPolicy: 'ONE_TIME_COMPANY_BOUND',
      revocationRef,
      pairDigest,
      ...(params.status && params.status !== 'ACTIVE' ? { status: params.status } : {}),
      authorityKeyId: keyMeta.keyId,
      authorityKeyVersion: keyMeta.keyVersion,
    };

    const keyLicenseFilePayload = {
      artifactType: 'LEDGERAI_KEY_LICENSE_FILE' as const,
      licensePairId,
      licenseId,
      keyFileId,
      companyId: params.companyId.trim(),
      productId: 'LEDGERAI-PH',
      activationKey: params.activationKey,
      planType: params.planType,
      type: params.type,
      durationType: params.durationType || (params.type === 'LIFETIME' ? 'lifetime' : 'yearly'),
      expirationDate: params.expirationDate,
      seatCount: params.seatCount,
      entitlements,
      deviceBindingHash: params.deviceBindingHash ? params.deviceBindingHash.trim() : null,
      issuedAt,
      issuerIdentity: 'LEDGERAI-PH-AUTHORITY',
      licenseVersion: '2.0',
      activationPolicy: 'ONE_TIME_COMPANY_BOUND',
      revocationRef,
      pairDigest,
      ...(params.status && params.status !== 'ACTIVE' ? { status: params.status } : {}),
      ...(params.recoveryReference ? { recoveryReference: params.recoveryReference } : {}),
      ...(params.recoveryReason ? { recoveryReason: params.recoveryReason } : {}),
      version: '2.0',
      authorityKeyId: keyMeta.keyId,
      authorityKeyVersion: keyMeta.keyVersion,
    };

    const licenseKeySignature = this.signLicense(licenseKeyFilePayload);
    const keyLicenseSignature = this.signLicense(keyLicenseFilePayload);

    const licenseKeyFileJson = JSON.stringify(
      { payload: licenseKeyFilePayload, signature: licenseKeySignature },
      null,
      2
    );
    const keyLicenseFileJson = JSON.stringify(
      { payload: keyLicenseFilePayload, signature: keyLicenseSignature },
      null,
      2
    );

    const container = Buffer.from(
      JSON.stringify({ payload: keyLicenseFilePayload, signature: keyLicenseSignature })
    ).toString('base64url');
    const compactToken = `LGR-${params.planType || 'PRO'}-${container}`;

    return {
      licensePairId,
      licenseId,
      keyFileId,
      pairDigest,
      revocationRef,
      licenseKeyFilePayload,
      licenseKeySignature,
      licenseKeyFileJson,
      keyLicenseFilePayload,
      keyLicenseSignature,
      keyLicenseFileJson,
      compactToken,
    };
  }
}
