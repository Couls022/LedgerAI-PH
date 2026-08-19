import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import fs from 'fs/promises';
import path from 'path';

describe('Production vs Development Bootstrapping Test', () => {
  const originalEnv = process.env.NODE_ENV;
  const testConfigDir = path.join(process.cwd(), 'temp_test_config');
  const testDataDir = path.join(process.cwd(), 'temp_test_data');

  beforeEach(async () => {
    process.env.LEDGERAI_CONFIG_DIR = testConfigDir;
    process.env.LEDGERAI_DATA_DIR = testDataDir;
    await fs.rm(testConfigDir, { recursive: true, force: true });
    await fs.rm(testDataDir, { recursive: true, force: true });
    await fs.mkdir(testConfigDir, { recursive: true });
    await fs.mkdir(testDataDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.LEDGERAI_CONFIG_DIR;
    delete process.env.LEDGERAI_DATA_DIR;
    await fs.rm(testConfigDir, { recursive: true, force: true });
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it('1. Production mode MUST NEVER seed test company on startup', async () => {
    process.env.NODE_ENV = 'production';

    await CompanyManager.init();

    const companies = await CompanyManager.listCompanies();
    expect(companies.length).toBe(0);
    expect(companies.find(c => c.legalName.includes('Test Corp'))).toBeUndefined();

    // Directly invoking seed method in production must also be a no-op
    await CompanyManager.seedDefaultCompanyIfEmpty();
    const companiesAfterDirect = await CompanyManager.listCompanies();
    expect(companiesAfterDirect.length).toBe(0);
  });

  it('2. Non-production mode seeds test company if empty', async () => {
    process.env.NODE_ENV = 'development';

    await CompanyManager.init();

    const companies = await CompanyManager.listCompanies();
    expect(companies.length).toBe(1);
    expect(companies[0].legalName).toBe('LedgerAI PH Test Corp');
    expect(companies[0].isDemo).toBe(true);
  });
});
