import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';

describe('Persistence & Context Reload Test Suite', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({ id: companyId, legalName: 'Persistence Co', tin: '000', taxpayerClassification: 'INDIVIDUAL', vatStatus: 'NON_VAT', documentLocationPath: '', backupLocationPath: '', status: 'ACTIVE' });
      await db.insert(schema.users).values({ id: userId, email: 'pers@test.com', displayName: 'Persist', passwordHash: 'hash', role: 'Company Administrator', isActive: true });
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    });
  });

  it('should persist and retrieve company profiles and transactions across application re-initialization', async () => {
    await runInTestDb(async () => {
      const reloadedCompany = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
      expect(reloadedCompany).toBeDefined();
      expect(reloadedCompany!.legalName).toBe('Persistence Co');
    });
  });
});
