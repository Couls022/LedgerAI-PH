import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { ElectronicFilingService } from '../../src/server/services/electronicFilingService';
import { DocumentSigner } from '../../src/server/services/documentSigner';
import { OfficialBirAdapter } from '../../src/server/services/taxFilingAdapter';

describe('LEDGERAI PH — Phase 7C: BIR Electronic Filing & Digital Signature Test Suite', () => {
  const companyId = crypto.randomUUID();
  const otherCompanyId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      // Insert test user
      await db.insert(schema.users).values({
        id: userId,
        email: 'phase7c@test.com',
        displayName: 'Phase 7C Accountant',
        passwordHash: 'hash',
        role: 'Accountant',
        isActive: true,
      });

      // Insert test companies
      await db.insert(schema.companies).values([
        {
          id: companyId,
          legalName: 'Phase 7C Electronics Corp',
          tin: '123-456-789-000',
          address: 'Makati City',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
          status: 'ACTIVE',
        },
        {
          id: otherCompanyId,
          legalName: 'Other Tenant Ltd',
          tin: '999-888-777-000',
          address: 'Quezon City',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'NON_VAT',
          status: 'ACTIVE',
        }
      ]);
    });
  });

  it('7C-01: Creates electronic filing draft with checksum and idempotency duplicate prevention', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'FORM_2307',
        reportingPeriod: '2026-Q3',
        records: [{ supplier: 'Vendor A', amount: 50000 }]
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'FORM_2307',
        '2026-Q3',
        payload,
        userId
      );

      expect(filing).toBeDefined();
      expect(filing.id).toBeDefined();
      expect(filing.status).toBe('DRAFT');
      expect(filing.artifactChecksum).toBeDefined();

      // Attempt duplicate creation for same company, filingType, reportingPeriod
      let duplicateErrorCaught = false;
      try {
        await ElectronicFilingService.createFiling(
          companyId,
          'FORM_2307',
          '2026-Q3',
          payload,
          userId
        );
      } catch (err: any) {
        duplicateErrorCaught = true;
        expect(err.message).toContain('DUPLICATE_SUBMISSION_PREVENTION');
      }
      expect(duplicateErrorCaught).toBe(true);
    });
  });

  it('7C-02: Validates filing payload and updates status to VALIDATED or VALIDATION_FAILED', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'FORM_1601EQ',
        reportingPeriod: '2026-08'
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'FORM_1601EQ',
        '2026-08',
        payload,
        userId
      );

      const validated = await ElectronicFilingService.validateFiling(filing.id, companyId, userId);
      expect(validated.status).toBe('VALIDATED');
      expect(validated.validation.valid).toBe(true);
    });
  });

  it('7C-03: Generates compliance filing package with checksum integrity verification', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'MAP',
        reportingPeriod: '2026-08',
        records: [{ id: 1 }]
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'MAP',
        '2026-08',
        payload,
        userId
      );

      await ElectronicFilingService.validateFiling(filing.id, companyId, userId);
      const pkg = await ElectronicFilingService.generatePackage(filing.id, companyId, userId);

      expect(pkg.status).toBe('PACKAGE_READY');
      expect(pkg.packageMetadata).toBeDefined();
      expect(pkg.packageMetadata.checksum).toBe(pkg.artifactChecksum);
    });
  });

  it('7C-04: Digital Signature Abstraction correctly signs payloads and returns SIGNING_PROVIDER_NOT_CONFIGURED when unconfigured', () => {
    const payload = { test: 'tax document' };
    
    // Without valid cert data
    const certCheck = DocumentSigner.validateCertificate('');
    expect(certCheck.valid).toBe(false);
    expect(certCheck.error).toContain('SIGNING_PROVIDER_NOT_CONFIGURED');

    let signErrorCaught = false;
    try {
      DocumentSigner.sign(payload, '');
    } catch (err: any) {
      signErrorCaught = true;
      expect(err.message).toContain('SIGNING_PROVIDER_NOT_CONFIGURED');
    }
    expect(signErrorCaught).toBe(true);

    // With valid mock cert / PEM
    const mockCert = '-----BEGIN CERTIFICATE-----\nMIID...mock...\n-----END CERTIFICATE-----';
    const signed = DocumentSigner.sign(payload, mockCert);
    expect(signed.signature).toBeDefined();
    expect(signed.signature.startsWith('SIG-RSA-SHA256-')).toBe(true);

    const verified = DocumentSigner.verify(payload, signed.signature, mockCert);
    expect(verified).toBe(true);
  });

  it('7C-05: Official BIR Adapter marks unconfigured external submissions as DEFERRED_EXTERNAL_INTEGRATION and never sets SUBMITTED', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'SAWT',
        reportingPeriod: '2026-Q3'
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'SAWT',
        '2026-Q3',
        payload,
        userId
      );

      await ElectronicFilingService.validateFiling(filing.id, companyId, userId);
      await ElectronicFilingService.generatePackage(filing.id, companyId, userId);

      const submitted = await ElectronicFilingService.submitFiling(filing.id, companyId, userId);

      // CRITICAL COMPLIANCE ASSERTION:
      // When no official external BIR connector is configured, SUBMIT must NOT result in SUBMITTED, ACCEPTED, or RECEIPT_RECEIVED.
      expect(submitted.status).toBe('DEFERRED_EXTERNAL_INTEGRATION');
      expect(submitted.status).not.toBe('SUBMITTED');
      expect(submitted.status).not.toBe('ACCEPTED');
      expect(submitted.receiptReference).toBeNull();
    });
  });

  it('7C-06: Tenant Isolation strictly prevents cross-company filing access', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'FORM_2307',
        reportingPeriod: '2026-Q2'
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'FORM_2307',
        '2026-Q2',
        payload,
        userId
      );

      // Attempting to access or validate with otherCompanyId should throw NOT_FOUND
      let accessError = false;
      try {
        await ElectronicFilingService.validateFiling(filing.id, otherCompanyId, userId);
      } catch (err: any) {
        accessError = true;
        expect(err.message).toContain('FILING_NOT_FOUND');
      }
      expect(accessError).toBe(true);
    });
  });

  it('7C-07: Bounded Retry Engine manages retry attempts safely up to max limit', async () => {
    await runInTestDb(async () => {
      const payload = {
        companyId,
        tin: '123-456-789-000',
        filingType: 'VAT_REL',
        reportingPeriod: '2026-Q3'
      };

      const filing = await ElectronicFilingService.createFiling(
        companyId,
        'VAT_REL',
        '2026-Q3',
        payload,
        userId
      );

      await ElectronicFilingService.validateFiling(filing.id, companyId, userId);
      await ElectronicFilingService.generatePackage(filing.id, companyId, userId);
      await ElectronicFilingService.submitFiling(filing.id, companyId, userId);

      // Retry when status is DEFERRED_EXTERNAL_INTEGRATION
      const retried = await ElectronicFilingService.retryFiling(filing.id, companyId, userId);
      expect(retried.attemptCount).toBe(2);
      expect(retried.status).toBe('DEFERRED_EXTERNAL_INTEGRATION');
    });
  });
});
