import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = typeof import.meta?.url === 'string' ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();

// INTERNAL LICENSE AUTHORITY SIGNER
// THIS FILE IS STRICTLY INTERNAL AND MUST NEVER BE BUNDLED INTO CLIENT RELEASES.

// Default Master Authority RSA Keypair (used by internal licensing authority)
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

export class AuthoritySigner {
  private static cachedPrivateKey: string | null = null;

  static getPrivateKey(): string {
    if (this.cachedPrivateKey) {
      return this.cachedPrivateKey;
    }

    let privateKey = process.env.LICENSE_PRIVATE_KEY;

    if (!privateKey) {
      const candidates = [
        path.join(process.env.APPDATA || process.env.HOME || process.cwd(), 'LedgerAI-PH-Authority', 'vault', 'keys.json'),
        path.resolve(__dirname, '../../internal/authority-keys/keys.json'),
        path.resolve(__dirname, '../authority-keys/keys.json'),
        path.resolve(process.cwd(), 'internal/authority-keys/keys.json'),
        path.resolve(process.cwd(), 'internal/authority-keys/authority_keys.json'),
        path.resolve(process.cwd(), 'tools/key-generator/keys.json'),
        path.resolve(__dirname, '../../tools/key-generator/keys.json'),
        path.resolve(process.cwd(), 'data/authority_keys.json'),
        'C:\\ProgramData\\LedgerAI PH\\Authority\\keys.json'
      ];

      for (const keysPath of candidates) {
        if (fs.existsSync(keysPath)) {
          try {
            const raw = fs.readFileSync(keysPath, 'utf8');
            const keys = JSON.parse(raw);
            if (keys && keys.privateKey) {
              privateKey = keys.privateKey;
              break;
            }
          } catch (e) {
            console.error(`[AuthoritySigner] Failed to parse key file at ${keysPath}:`, e);
          }
        }
      }
    }

    if (!privateKey) {
      // Automatic fallback to default master authority key and persist to vault
      privateKey = DEFAULT_AUTHORITY_PRIVATE_KEY;
      try {
        const vaultDir = path.resolve(process.cwd(), 'internal/authority-keys');
        if (!fs.existsSync(vaultDir)) {
          fs.mkdirSync(vaultDir, { recursive: true });
        }
        const keyJsonPath = path.join(vaultDir, 'keys.json');
        if (!fs.existsSync(keyJsonPath)) {
          fs.writeFileSync(keyJsonPath, JSON.stringify({ privateKey }, null, 2), 'utf8');
        }
      } catch (e) {
        // Non-fatal
      }
    }

    this.cachedPrivateKey = privateKey;
    return privateKey;
  }

  /**
   * Signs a license payload using SHA256withRSA and the Authority Private Key
   */
  static signLicense(licenseData: any): string {
    const privateKey = this.getPrivateKey();
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(licenseData));
    sign.end();
    return sign.sign(privateKey, 'base64');
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

    // Format self-contained compact activation key token
    const container = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
    const compactToken = `LGR-${payload.planType || 'PRO'}-${container}`;

    return {
      payload,
      signature,
      json,
      compactToken
    };
  }
}

