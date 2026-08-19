import { describe, it, expect, beforeEach } from 'vitest';
import { verifyLicense, RSA_PUBLIC_KEY } from '../../src/server/licensing/verify';
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
    expect(clientVerifyFile).not.toContain('sign(');
    expect(clientVerifyFile).not.toContain('createSign');
    expect(clientVerifyFile).not.toContain('BEGIN PRIVATE KEY');
    expect(clientVerifyFile).toContain('RSA_PUBLIC_KEY');
    expect(clientVerifyFile).toContain('createVerify');
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
});
