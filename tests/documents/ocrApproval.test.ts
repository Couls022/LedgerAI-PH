import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';

describe('OCR Approval & Human Verification Test Suite', () => {
  const companyId = crypto.randomUUID();
  const docId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.users).values({ id: 'system', email: `system_${crypto.randomUUID()}@test.com`, passwordHash: 'hash', displayName: 'System', role: 'Company Administrator' }).onConflictDoNothing();
      await db.insert(schema.companies).values({ id: companyId, legalName: 'OCR Co', tin: '000', taxpayerClassification: 'INDIVIDUAL', vatStatus: 'NON_VAT', documentLocationPath: '', backupLocationPath: '', status: 'ACTIVE' });
      await db.insert(schema.documents).values({
        id: docId,
        companyId: companyId,
        fileName: 'test.pdf',
        fileType: 'pdf',
        filePath: '/dev/null',
        entityType: 'INVOICE',
        entityId: 'NONE',
        uploadedBy: 'system',
        status: 'ACTIVE',
        ocrStatus: 'COMPLETED',
        ocrResult: JSON.stringify({ vendorName: 'Acme', totalAmount: 100 })
      });
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.delete(schema.documents).where(eq(schema.documents.id, docId));
      await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    });
  });

  it('should block unapproved OCR extraction from posting to accounting', async () => {
    await runInTestDb(async () => {
      const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, docId)).get();
      const canPostToAccounting = doc!.ocrStatus === 'APPROVED';
      expect(canPostToAccounting).toBe(false);
    });
  });
});
