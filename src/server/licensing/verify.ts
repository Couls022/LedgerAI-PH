import crypto from 'crypto';

// The LedgerAI Client contains ONLY the Public Key for Signature Verification.
// Private keys and signing infrastructure NEVER exist in client distributions.
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

export interface LicensePayload {
  licenseId: string;
  companyId: string;
  productId?: string;
  activationKey: string;
  planType: 'PRO' | 'ENTERPRISE' | string;
  type?: 'TERM' | 'LIFETIME' | string;
  durationType?: 'custom' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | string;
  expirationDate?: string | null;
  issuedAt?: string;
  version?: string;
  deviceBindingHash?: string | null;
  [key: string]: any;
}

/**
 * Client-Side License Signature Verification
 * Verifies an RSA-SHA256 digital signature against the embedded authority public key.
 */
export function verifyLicense(licenseData: any, signature: string): boolean {
  if (!licenseData || !signature) {
    return false;
  }
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(licenseData));
    verify.end();
    return verify.verify(RSA_PUBLIC_KEY, signature, 'base64');
  } catch (err) {
    console.error('[LicenseVerifier] Verification error:', err);
    return false;
  }
}

/**
 * Parses and verifies a self-contained compact activation key token or license string.
 * Formats supported:
 * 1. Compact token: LGR-[PLAN]-[BASE64URL_PAYLOAD_AND_SIG] or LGR-[BASE64URL(payload)].[BASE64URL(signature)]
 * 2. Raw JSON string or Base64 JSON of { payload, signature }
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
        // Strip prefix if present (e.g. LGR-PRO-)
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
 * Universal extractor: safely resolves valid payload & signature from either an activation key, a .lai file, or both.
 */
export function extractAndValidateLicense(options: {
  activationKey?: string;
  licenseFile?: string;
}): { valid: boolean; payload?: LicensePayload; signature?: string; keyString?: string; error?: string } {
  const { activationKey, licenseFile } = options;

  // Case 1: .lai File content provided
  if (licenseFile && licenseFile.trim().length > 0) {
    try {
      const parsedFile = JSON.parse(licenseFile.trim());
      const { payload, signature } = parsedFile;
      if (!payload || !signature) {
        return { valid: false, error: 'License file is missing cryptographic payload or signature.' };
      }
      const isValid = verifyLicense(payload, signature);
      if (!isValid) {
        return { valid: false, error: 'Cryptographic validation failed. The license file has been tampered with or is invalid.' };
      }
      return { 
        valid: true, 
        payload, 
        signature, 
        keyString: payload.activationKey || activationKey || 'LGR-ACTIVATED' 
      };
    } catch (e: any) {
      return { valid: false, error: `Invalid license file format: ${e.message}` };
    }
  }

  // Case 2: Activation Key string provided (standalone compact token)
  if (activationKey && activationKey.trim().length > 0) {
    const tokenResult = parseAndVerifyToken(activationKey.trim());
    if (tokenResult.valid && tokenResult.payload && tokenResult.signature) {
      return {
        valid: true,
        payload: tokenResult.payload,
        signature: tokenResult.signature,
        keyString: tokenResult.payload.activationKey || activationKey.trim()
      };
    } else {
      return {
        valid: false,
        error: tokenResult.error || 'The activation key could not be verified. Please enter a valid signed activation key or upload a .lai license file.'
      };
    }
  }

  return { valid: false, error: 'Please provide either an Activation Key or upload a .lai License File.' };
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

