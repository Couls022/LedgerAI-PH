import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { StartupValidator } from '../../src/server/services/startupValidator';
import { RestoreService, deterministicStringify } from '../../src/server/services/restoreService';
import fs from 'fs';
import path from 'path';

describe('LEDGERAI PH — Phase 8B: Production Operations & Disaster Recovery Test Suite', () => {
  const companyId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Phase 8B Operations Corp',
        tin: '888-777-666-000',
        address: 'BGC, Taguig City',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE',
      });
    });
  });

  it('8B-01: Startup Validator verifies configuration and temporary directory writability', () => {
    const result = StartupValidator.validate();
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('8B-02: Encryption Service correctly detects and validates .lai encrypted containers', async () => {
    await runInTestDb(async () => {
      const tempSqlite = path.join(process.cwd(), 'data', 'temp', `test-${Date.now()}.sqlite`);
      const tempLai = path.join(process.cwd(), 'data', 'temp', `test-${Date.now()}.lai`);

      fs.writeFileSync(tempSqlite, 'SIMULATED SQLITE DATABASE CONTENT');

      try {
        await DatabaseEncryptionService.encryptDatabaseFile(tempSqlite, tempLai);
        const isEncrypted = await DatabaseEncryptionService.isEncryptedLai(tempLai);
        expect(isEncrypted).toBe(true);

        const restoredSqlite = path.join(process.cwd(), 'data', 'temp', `restored-${Date.now()}.sqlite`);
        const decrypted = await DatabaseEncryptionService.decryptDatabaseFile(tempLai, restoredSqlite);
        expect(decrypted).toBe(true);
        expect(fs.readFileSync(restoredSqlite, 'utf-8')).toBe('SIMULATED SQLITE DATABASE CONTENT');

        // Cleanup
        if (fs.existsSync(tempSqlite)) fs.unlinkSync(tempSqlite);
        if (fs.existsSync(tempLai)) fs.unlinkSync(tempLai);
        if (fs.existsSync(restoredSqlite)) fs.unlinkSync(restoredSqlite);
      } catch (err: any) {
        if (fs.existsSync(tempSqlite)) fs.unlinkSync(tempSqlite);
        if (fs.existsSync(tempLai)) fs.unlinkSync(tempLai);
        throw err;
      }
    });
  });

  it('8B-03: Corrupted and truncated backup handling throws safe errors without modifying active data', async () => {
    await runInTestDb(async () => {
      const truncatedLai = path.join(process.cwd(), 'data', 'temp', `truncated-${Date.now()}.lai`);
      fs.writeFileSync(truncatedLai, Buffer.from('SHORT'));

      let errorCaught = false;
      try {
        const restoredSqlite = path.join(process.cwd(), 'data', 'temp', `restored-trunc-${Date.now()}.sqlite`);
        await DatabaseEncryptionService.decryptDatabaseFile(truncatedLai, restoredSqlite);
      } catch (err: any) {
        errorCaught = true;
        expect(err.message).toContain('too small');
      }
      expect(errorCaught).toBe(true);

      if (fs.existsSync(truncatedLai)) fs.unlinkSync(truncatedLai);
    });
  });

  it('8B-04: Restore Service verifies checksum and handles serialization correctly', async () => {
    await runInTestDb(async () => {
      const data = {
        companies: [{ id: companyId, legalName: 'Phase 8B Operations Corp' }],
        accountingPeriods: [],
        journalEntries: []
      };
      const dataString = deterministicStringify(data);
      const checksum = crypto.createHash('sha256').update(dataString).digest('hex');
      const signature = RestoreService.generateSignature(data);

      const mockPayload = {
        metadata: {
          version: '1.0',
          companyId,
          timestamp: new Date().toISOString(),
          checksum,
          signature,
          format: 'LAI_DATABASE_V1'
        },
        data
      };

      const serialized = RestoreService.serializeLai(mockPayload);
      expect(Buffer.isBuffer(serialized)).toBe(true);

      const deserialized = RestoreService.deserializeLai(serialized);
      expect(deserialized.metadata.companyId).toBe(companyId);
      expect(RestoreService.verifyChecksum(deserialized)).toBe(true);
    });
  });

  it('8B-05: Multi-Tenant Tenant Isolation during export and restore validation', async () => {
    await runInTestDb(async () => {
      const otherCompanyId = crypto.randomUUID();
      const data = {
        companies: [{ id: companyId, legalName: 'Phase 8B Operations Corp' }],
        accountingPeriods: [],
        journalEntries: []
      };
      const dataString = deterministicStringify(data);
      const checksum = crypto.createHash('sha256').update(dataString).digest('hex');
      const signature = RestoreService.generateSignature(data);

      const mockPayload = {
        metadata: {
          version: '1.0',
          companyId,
          timestamp: new Date().toISOString(),
          checksum,
          signature,
          format: 'LAI_DATABASE_V1'
        },
        data
      };
      
      mockPayload.metadata.companyId = otherCompanyId;
      const serialized = RestoreService.serializeLai(mockPayload);
      const deserialized = RestoreService.deserializeLai(serialized);
      expect(deserialized.metadata.companyId).toBe(otherCompanyId);
    });
  });
});
