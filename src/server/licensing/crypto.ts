import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// The LedgerAI Client ONLY contains the Public Key for Verification.
// The Private Key exists strictly in the separate offline Key Generator.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAizbGPU/536YEOQEysjhG
jdR83gR2AwJKJ7W+jF7iB2EIvYpPPt/dMsqpwjxR8vsVYg1Ic6qSQ9yLvVXxwlTX
jvG7sTmME4+Z2qzTccO6EIEXm2Ij3s2PhN6VXdqUwkDJJeMx3W9/fWFfvJ1QbYqY
9MTZEqGM6x33zBEedDLW1vO7fWui3Qx/wnaIwFLvH+CCiPz8fHpKo9Ljt04KRh1j
zi05grG3ocfk2n9ww4N/N4SfYb9hp2WVQtWxvEsuPoCuWcA/QJomt9Wb3XVIRl+o
hwhw9GDk2H5ibM6vAJlAuUIkOA6PuQE251bBpyqHaq7fFF0M7fTkgDAXgHaOifw2
rQIDAQAB
-----END PUBLIC KEY-----
`;

export class AuthorityCrypto {
  static signLicense(licenseData: any): string {
    let privateKey = process.env.LICENSE_PRIVATE_KEY;

    if (!privateKey) {
      const candidates = [
        path.resolve(process.cwd(), 'tools/key-generator/keys.json')
      ];

      for (const keysPath of candidates) {
        if (fs.existsSync(keysPath)) {
          try {
            const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
            if (keys && keys.privateKey) {
              privateKey = keys.privateKey;
              break;
            }
          } catch (e) {
            console.error(`Error reading key file at ${keysPath}:`, e);
          }
        }
      }
    }

    if (!privateKey) {
      throw new Error('MISSING_SIGNING_KEY: Private signing key material is not configured on the server.');
    }

    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(licenseData));
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  static getPublicKey(): string {
    return PUBLIC_KEY;
  }

  static verifyLicense(licenseData: any, signature: string): boolean {
    const verify = crypto.createVerify('SHA256');
    verify.update(JSON.stringify(licenseData));
    verify.end();
    return verify.verify(PUBLIC_KEY, signature, 'base64');
  }
}
