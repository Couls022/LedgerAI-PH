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
    delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;
    await CompanyManager.closeAllConnections();
    await fs.rm(testConfigDir, { recursive: true, force: true });
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it('1. Production mode MUST NEVER seed test company on startup', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;

    await CompanyManager.init();

    const companies = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(companies.length).toBe(0);
    expect(companies.find(c => c.legalName.includes('Test Corp'))).toBeUndefined();

    // Directly invoking seed method in production must also be a no-op
    await CompanyManager.seedDefaultCompanyIfEmpty();
    const companiesAfterDirect = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(companiesAfterDirect.length).toBe(0);
  });

  it('2. Clean start in development mode starts with zero companies by default; explicit opt-in enables demo seeding', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;

    await CompanyManager.init();

    const defaultCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(defaultCompanies.length).toBe(0);

    // Only when explicitly opted in via LEDGERAI_ALLOW_AUTO_DEMO_SEED=true does demo seeding run
    process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED = 'true';
    await CompanyManager.init();

    const seededCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(seededCompanies.length).toBeGreaterThanOrEqual(1);
    const testComp = seededCompanies.find(c => c.legalName === 'LedgerAI PH Test Corp');
    expect(testComp).toBeDefined();
    expect(testComp!.isDemo).toBe(true);
  });
});
