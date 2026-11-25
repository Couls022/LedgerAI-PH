import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  verifyLicense,
  RSA_PUBLIC_KEY,
  DEV_TEST_AUTHORITY_KEY_ID,
  registerAuthorityPublicKey,
  revokeAuthorityKeyId,
  resetAuthorityKeyRingForTesting,
} from '../../src/server/licensing/verify';
import { AuthoritySigner } from '../../internal/key-generator/signer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { validateActiveLicenseForCompany } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { companies, companyLicenses } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import { runInTestDb } from '../setup';
import { createApp } from '../../src/server/app';

describe('LedgerAI PH Client Verification & Authority Isolation Tests', () => {
  const companyIdA = 'LGR-PH-2026-TEC-00-85CBBDAF'; // DeskGuard Solutions
  const companyIdB = 'LGR-PH-2026-COR-00-99999999';

  beforeEach(async () => {
    resetAuthorityKeyRingForTesting();
    AuthoritySigner.clearCacheForTesting();
    delete process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY;
    delete process.env.LEDGERAI_AUTHORITY_MODE;
    delete process.env.LEDGERAI_REVOKED_AUTHORITY_KEY_IDS;

    await runInTestDb(async () => {
      await db.delete(companyLicenses).where(eq(companyLicenses.companyId, companyIdA));
      await db.delete(companyLicenses).where(eq(companyLicenses.companyId, companyIdB));

      // Ensure company A exists in test DB
      const existing = await db.select().from(companies).where(eq(companies.id, companyIdA)).get();
      if (!existing) {
        await db.insert(companies).values({
          id: companyIdA,
          legalName: 'DeskGuard Solutions Inc',
          tin: '123-456-789-000',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT_REGISTERED',
          documentLocationPath: '',
          backupLocationPath: '',
          status: 'ACTIVE'
        });
      }
    });
  });

  afterEach(() => {
    resetAuthorityKeyRingForTesting();
    AuthoritySigner.clearCacheForTesting();
    delete process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY;
    delete process.env.LEDGERAI_AUTHORITY_MODE;
    delete process.env.LEDGERAI_REVOKED_AUTHORITY_KEY_IDS;
  });

  it('1. Client license verification succeeds with a valid signed license', () => {
    const activationKey = 'LGR-PRO-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const licenseId = crypto.randomUUID();
    const expDate = '2027-12-31';

    const payload = {
      licenseId,
      companyId: companyIdA,
      productId: 'LEDGERAI-PH',
      activationKey,
      planType: 'PRO',
      type: 'TERM',
      expirationDate: expDate,
      issuedAt: new Date().toISOString(),
      version: '1.0'
    };

    const signature = AuthoritySigner.signLicense(payload);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(50);

    const isValid = verifyLicense(payload, signature);
    expect(isValid).toBe(true);
  });

  it('2. Client rejects modified/tampered licenses', () => {
    const activationKey = 'LGR-PRO-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const payload = {
      licenseId: crypto.randomUUID(),
      companyId: companyIdA,
      productId: 'LEDGERAI-PH',
      activationKey,
      planType: 'PRO',
      type: 'TERM',
      expirationDate: '2027-12-31',
      issuedAt: new Date().toISOString(),
      version: '1.0'
    };

    const signature = AuthoritySigner.signLicense(payload);

    // Tamper with planType
    const tamperedPayload = { ...payload, planType: 'ENTERPRISE' };
    const isValid = verifyLicense(tamperedPayload, signature);
    expect(isValid).toBe(false);
  });

  it('3. Client rejects invalid signatures', () => {
    const payload = {
      licenseId: crypto.randomUUID(),
      companyId: companyIdA,
      productId: 'LEDGERAI-PH',
      activationKey: 'LGR-PRO-TEST',
      planType: 'PRO',
      type: 'TERM',
      expirationDate: '2027-12-31',
      issuedAt: new Date().toISOString(),
      version: '1.0'
    };

    const fakeSignature = Buffer.from('invalid-signature-data').toString('base64');
    const isValid = verifyLicense(payload, fakeSignature);
    expect(isValid).toBe(false);
  });

  it('4. Client rejects expired licenses', async () => {
    await runInTestDb(async () => {
      const payload = {
        licenseId: crypto.randomUUID(),
        companyId: companyIdA,
        productId: 'LEDGERAI-PH',
        activationKey: 'LGR-PRO-EXPIRED',
        planType: 'PRO',
        type: 'TERM',
        expirationDate: '2020-01-01', // Past date
        issuedAt: new Date().toISOString(),
        version: '1.0'
      };

      const signature = AuthoritySigner.signLicense(payload);
      const signedContent = JSON.stringify({ payload, signature }, null, 2);

      await db.insert(companyLicenses).values({
        id: payload.licenseId,
        companyId: companyIdA,
        licenseKey: payload.activationKey,
        planType: 'PRO',
        status: 'ACTIVE',
        trialStartDate: '2019-01-01',
        expirationDate: '2020-01-01',
        signedFileContent: signedContent,
        isLifetime: false
      });

      const status = await validateActiveLicenseForCompany(companyIdA);
      expect(status.valid).toBe(false);
      expect(status.code).toBe('LICENSE_EXPIRED');
    });
  });

  it('5. Client rejects license for another company', async () => {
    await runInTestDb(async () => {
      const payload = {
        licenseId: crypto.randomUUID(),
        companyId: companyIdB, // Belongs to Company B
        productId: 'LEDGERAI-PH',
        activationKey: 'LGR-PRO-FOR-B',
        planType: 'PRO',
        type: 'TERM',
        expirationDate: '2027-12-31',
        issuedAt: new Date().toISOString(),
        version: '1.0'
      };

      const signature = AuthoritySigner.signLicense(payload);
      const signedContent = JSON.stringify({ payload, signature }, null, 2);

      // Save into Company A's slot
      await db.insert(companyLicenses).values({
        id: payload.licenseId,
        companyId: companyIdA,
        licenseKey: payload.activationKey,
        planType: 'PRO',
        status: 'ACTIVE',
        trialStartDate: '2026-01-01',
        expirationDate: '2027-12-31',
        signedFileContent: signedContent,
        isLifetime: false
      });

      const status = await validateActiveLicenseForCompany(companyIdA);
      expect(status.valid).toBe(false);
      expect(status.code).toBe('LICENSE_INVALID');
    });
  });

  it('6. Client codebase does NOT contain signing capabilities or private keys in src/', () => {
    const clientVerifyFile = fs.readFileSync(path.resolve(process.cwd(), 'src/server/licensing/verify.ts'), 'utf8');
    const clientCryptoFile = fs.readFileSync(path.resolve(process.cwd(), 'src/server/licensing/crypto.ts'), 'utf8');
    expect(clientVerifyFile).not.toContain('sign(');
    expect(clientVerifyFile).not.toContain('createSign');
    expect(clientVerifyFile).not.toContain('BEGIN PRIVATE KEY');
    expect(clientVerifyFile).toContain('RSA_PUBLIC_KEY');
    expect(clientVerifyFile).toContain('createVerify');
    expect(clientCryptoFile).not.toContain('createSign');
    expect(clientCryptoFile).not.toContain('BEGIN PRIVATE KEY');
  });

  it('7. Client express app does NOT register /api/authority routes', () => {
    const app = createApp();
    const routes: string[] = [];
    const printRoutes = (stack: any[]) => {
      stack.forEach((layer) => {
        if (layer.route) {
          routes.push(layer.route.path);
        } else if (layer.name === 'router' && layer.handle?.stack) {
          printRoutes(layer.handle.stack);
        }
      });
    };

    if (app._router && app._router.stack) {
      printRoutes(app._router.stack);
    }

    const authorityRoutes = routes.filter(r => typeof r === 'string' && r.includes('/authority'));
    expect(authorityRoutes).toHaveLength(0);
  });

  it('8. enforces Production Authority Key Lifecycle: supports key rotation (v1 -> v2), revokes compromised/retired keys, and blocks dev/test signing when production key enforcement is active', () => {
    // Generate an ephemeral simulated rotated production RSA-2048 keypair in memory (never persisted or exposed)
    const { publicKey: prodPublicKeyPem, privateKey: prodPrivateKeyPem } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const prodKeyId = 'LGR-AUTH-KEY-PROD-2026-V2';
    registerAuthorityPublicKey({
      keyId: prodKeyId,
      keyVersion: 2,
      environment: 'PRODUCTION',
      status: 'ACTIVE',
      publicKeyPem: prodPublicKeyPem,
      effectiveFrom: '2026-11-07T00:00:00.000Z',
    });

    // Sign a license with the rotated production key (v2)
    const basePayload = {
      licenseId: crypto.randomUUID(),
      companyId: companyIdA,
      productId: 'LEDGERAI-PH',
      activationKey: 'LGR-ENT-PROD-V2',
      planType: 'ENTERPRISE',
      type: 'TERM',
      expirationDate: '2027-12-31',
      issuedAt: new Date().toISOString(),
      version: '1.0',
    };

    const { signedPayload: prodPayload, signature: prodSignature } = AuthoritySigner.signLicenseWithCustomKey(
      basePayload,
      { privateKeyPem: prodPrivateKeyPem, keyId: prodKeyId, keyVersion: 2 }
    );

    // Sign a license with the default dev/test key (v1)
    const devArtifact = AuthoritySigner.generateSignedLicenseArtifact({
      ...basePayload,
      licenseId: crypto.randomUUID(),
      activationKey: 'LGR-PRO-DEV-V1',
    });

    // In default (dev/test) mode, both v1 dev license and v2 prod license verify
    expect(verifyLicense(devArtifact.payload, devArtifact.signature)).toBe(true);
    expect(verifyLicense(prodPayload, prodSignature)).toBe(true);

    // When LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY=true:
    // 1. Verifier rejects dev/test key (LGR-AUTH-KEY-DEV-2026-V1) while continuing to accept rotated production key (v2)
    process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY = 'true';
    AuthoritySigner.clearCacheForTesting();
    expect(verifyLicense(devArtifact.payload, devArtifact.signature)).toBe(false);
    expect(verifyLicense(prodPayload, prodSignature)).toBe(true);

    // 2. Signer refuses to sign with default dev/test key in production mode
    expect(() => AuthoritySigner.signLicense(basePayload)).toThrow(/PRODUCTION_SIGNING_KEY_REQUIRED/);

    // 3. Explicit key revocation immediately invalidates licenses signed by that keyId
    delete process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY;
    revokeAuthorityKeyId(DEV_TEST_AUTHORITY_KEY_ID, 'Rotated to production HSM key V2');
    expect(verifyLicense(devArtifact.payload, devArtifact.signature)).toBe(false);
    expect(verifyLicense(prodPayload, prodSignature)).toBe(true);
  });
});
