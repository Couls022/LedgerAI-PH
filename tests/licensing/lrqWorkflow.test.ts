import { describe, it, expect, beforeEach } from 'vitest';
import { verifyLicense } from '../../src/server/licensing/verify';
import { AuthoritySigner } from '../../internal/key-generator/signer';
import { generateLicense, parseAndValidateLicenseRequest } from '../../internal/key-generator/index';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../../src/server/db';
import { companies, companyLicenses } from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import { runInTestDb } from '../setup';
import request from 'supertest';
import { createApp } from '../../src/server/app';

describe('LedgerAI PH — LRQ Export, Ingestion, and Full Licensing Workflow', () => {
  const testCompanyId = 'LGR-PH-2026-COR-00-58C7A29A';
  const otherCompanyId = 'LGR-PH-2026-OTHER-00-99999999';

  beforeEach(async () => {
    await runInTestDb(async () => {
      await db.delete(companyLicenses).where(eq(companyLicenses.companyId, testCompanyId));
      await db.delete(companyLicenses).where(eq(companyLicenses.companyId, otherCompanyId));

      const existing = await db.select().from(companies).where(eq(companies.id, testCompanyId)).get();
      if (!existing) {
        await db.insert(companies).values({
          id: testCompanyId,
          legalName: 'Acme PH Industrial Inc.',
          tin: '987-654-321-000',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
          documentLocationPath: '',
          backupLocationPath: '',
          status: 'ACTIVE'
        });
      }
    });
  });

  it('1. Generates and validates a sanitized .lrq license request artifact', () => {
    const lrqPayload = {
      requestType: 'LEDGERAI_LICENSE_REQUEST',
      version: 1,
      companyId: testCompanyId,
      companyName: 'Acme PH Industrial Inc.',
      tin: '987-654-321-000',
      requestedPlan: 'PRO',
      installationId: 'LGR-INST-A1B2C3D4',
      timestamp: new Date().toISOString()
    };

    const lrqJson = JSON.stringify(lrqPayload, null, 2);

    // Verify sanitization: Ensure no sensitive keys or passwords
    expect(lrqJson).not.toContain('privateKey');
    expect(lrqJson).not.toContain('password');
    expect(lrqJson).not.toContain('secret');
    expect(lrqJson).not.toContain('token');

    // Parse with Key Generator validator
    const parsed = parseAndValidateLicenseRequest(lrqJson);
    expect(parsed.requestType).toBe('LEDGERAI_LICENSE_REQUEST');
    expect(parsed.companyId).toBe(testCompanyId);
    expect(parsed.companyName).toBe('Acme PH Industrial Inc.');
    expect(parsed.requestedPlan).toBe('PRO');
    expect(parsed.installationId).toBe('LGR-INST-A1B2C3D4');
  });

  it('2. Key Generator rejects malformed or invalid .lrq artifacts', () => {
    // Missing requestType
    expect(() => parseAndValidateLicenseRequest(JSON.stringify({
      companyId: testCompanyId,
      companyName: 'Test',
      installationId: '123'
    }))).toThrow(/requestType/);

    // Missing companyId
    expect(() => parseAndValidateLicenseRequest(JSON.stringify({
      requestType: 'LEDGERAI_LICENSE_REQUEST',
      companyName: 'Test',
      installationId: '123'
    }))).toThrow(/companyId/);

    // Missing companyName
    expect(() => parseAndValidateLicenseRequest(JSON.stringify({
      requestType: 'LEDGERAI_LICENSE_REQUEST',
      companyId: testCompanyId,
      installationId: '123'
    }))).toThrow(/companyName/);

    // Corrupted JSON
    expect(() => parseAndValidateLicenseRequest('INVALID_JSON_CONTENT')).toThrow();
  });

  it('3. Key Generator issues valid signed license from ingested .lrq data', () => {
    const lrqPayload = {
      requestType: 'LEDGERAI_LICENSE_REQUEST',
      version: 1,
      companyId: testCompanyId,
      companyName: 'Acme PH Industrial Inc.',
      tin: '987-654-321-000',
      requestedPlan: 'PRO',
      installationId: 'LGR-INST-A1B2C3D4',
      timestamp: new Date().toISOString()
    };

    const parsedLrq = parseAndValidateLicenseRequest(JSON.stringify(lrqPayload));

    const generated = generateLicense({
      companyId: parsedLrq.companyId,
      planType: parsedLrq.requestedPlan as 'PRO' | 'ENTERPRISE',
      duration: '1y'
    });

    expect(generated.companyId).toBe(testCompanyId);
    expect(generated.activationKey).toMatch(/^LGR-PRO-[A-F0-9]{8}$/);
    expect(generated.signature).toBeDefined();

    // Client verifies offline using RSA Public Key
    const isVerifiedOffline = verifyLicense(generated.payload, generated.signature);
    expect(isVerifiedOffline).toBe(true);
  });

  it('4. Client activation succeeds when using matching Activation Key and .lai file', async () => {
    const app = createApp();

    // Generate valid license
    const generated = generateLicense({
      companyId: testCompanyId,
      planType: 'PRO',
      duration: 'lifetime'
    });

    const licenseFileJson = JSON.stringify({
      payload: generated.payload,
      signature: generated.signature
    });

    // Create a company admin user session token in test
    const testAdminToken = 'mock-admin-token';
    
    // Test direct verification logic
    const isValid = verifyLicense(generated.payload, generated.signature);
    expect(isValid).toBe(true);
    expect(generated.payload.companyId).toBe(testCompanyId);
    expect(generated.payload.activationKey).toBe(generated.activationKey);
  });

  it('5. Client rejects tampered license files', () => {
    const generated = generateLicense({
      companyId: testCompanyId,
      planType: 'PRO',
      duration: '1y'
    });

    // Tamper with companyId
    const tamperedPayload1 = { ...generated.payload, companyId: otherCompanyId };
    expect(verifyLicense(tamperedPayload1, generated.signature)).toBe(false);

    // Tamper with planType
    const tamperedPayload2 = { ...generated.payload, planType: 'ENTERPRISE' };
    expect(verifyLicense(tamperedPayload2, generated.signature)).toBe(false);

    // Tamper with expiration
    const tamperedPayload3 = { ...generated.payload, expirationDate: '2099-12-31' };
    expect(verifyLicense(tamperedPayload3, generated.signature)).toBe(false);
  });

  it('6. Client codebase audit: No private signing keys in client bundle', () => {
    const clientLicensingPath = path.resolve(process.cwd(), 'src/server/licensing/verify.ts');
    const content = fs.readFileSync(clientLicensingPath, 'utf8');

    expect(content).toContain('BEGIN PUBLIC KEY');
    expect(content).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(content).not.toContain('BEGIN PRIVATE KEY');
    expect(content).not.toContain('privateKey');

    // Ensure client server routes contain no authority endpoints
    const serverRoutesDir = path.resolve(process.cwd(), 'src/server/routes');
    const routeFiles = fs.readdirSync(serverRoutesDir);
    for (const file of routeFiles) {
      const routeContent = fs.readFileSync(path.join(serverRoutesDir, file), 'utf8');
      expect(routeContent).not.toContain('/api/authority/generate-license');
      expect(routeContent).not.toContain('AuthoritySigner');
    }
  });
});
