import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CompanyManager } from '../../src/server/services/companyManager';
import fs from 'fs/promises';
import path from 'path';

describe('Storage Overlap Security', () => {
  const root = path.join(process.cwd(), 'data', 'OverlapTest');
  
  beforeAll(async () => {
    await fs.mkdir(root, { recursive: true });
    // mock listCompanies
    CompanyManager.listCompanies = async () => [
      { id: 'C1', location: path.join(root, 'C1'), dbPath: '', status: 'ACTIVE' },
      { id: 'C2', location: path.join(root, 'C2'), dbPath: '', status: 'ACTIVE' }
    ] as any;
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('should allow valid non-overlapping paths', async () => {
    await expect(CompanyManager.validateStorageIsolation('C3', path.join(root, 'C3'))).resolves.toBeTruthy();
  });

  it('should block identical paths', async () => {
    await expect(CompanyManager.validateStorageIsolation('C3', path.join(root, 'C1'))).rejects.toThrow('STORAGE_ISOLATION_ERROR');
  });

  it('should block nested paths', async () => {
    await expect(CompanyManager.validateStorageIsolation('C3', path.join(root, 'C1', 'nested'))).rejects.toThrow('STORAGE_ISOLATION_ERROR');
  });

  it('should block parent paths that encapsulate another company', async () => {
    await expect(CompanyManager.validateStorageIsolation('C1', root)).rejects.toThrow('STORAGE_ISOLATION_ERROR');
  });
});
