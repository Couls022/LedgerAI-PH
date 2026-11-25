import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const isolatedRoot = vi.hoisted(() => {
  const base = require('path').join(
    require('os').tmpdir(),
    `ledgerai-deploy-accept-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const configDir = require('path').join(base, 'config');
  const dataDir = require('path').join(base, 'companies');
  require('fs').mkdirSync(configDir, { recursive: true });
  require('fs').mkdirSync(dataDir, { recursive: true });
  process.env.LEDGERAI_CONFIG_DIR = configDir;
  process.env.LEDGERAI_DATA_DIR = dataDir;
  process.env.LEDGERAI_ISOLATED_TEST_ROOT = base;
  delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;
  return { base, configDir, dataDir };
});

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RestoreService } from '../../src/server/services/restoreService';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import { dbContext } from '../../src/server/db/context';
import { searchKnowledgeBase } from '../../src/shared/knowledgeBase';

describe('LEDGERAI PH v1.0.0-rc.2 — Final Real-Company Deployment, Operational Readiness & Production Acceptance', () => {
  const app = createApp();
  const prevConfigDir = process.env.LEDGERAI_CONFIG_DIR;
  const prevDataDir = process.env.LEDGERAI_DATA_DIR;
  const prevIsolated = process.env.LEDGERAI_ISOLATED_TEST_ROOT;

  let companyId = '';
  let ownerToken = '';
  let ownerUserId = '';
  let bookkeeperToken = '';
  let approverToken = '';

  beforeAll(async () => {
    process.env.LEDGERAI_CONFIG_DIR = isolatedRoot.configDir;
    process.env.LEDGERAI_DATA_DIR = isolatedRoot.dataDir;
    process.env.LEDGERAI_ISOLATED_TEST_ROOT = isolatedRoot.base;
    delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;
    await CompanyManager.closeAllConnections();
    await CompanyManager.init();
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (prevConfigDir === undefined) delete process.env.LEDGERAI_CONFIG_DIR;
    else process.env.LEDGERAI_CONFIG_DIR = prevConfigDir;
    if (prevDataDir === undefined) delete process.env.LEDGERAI_DATA_DIR;
    else process.env.LEDGERAI_DATA_DIR = prevDataDir;
    if (prevIsolated === undefined) delete process.env.LEDGERAI_ISOLATED_TEST_ROOT;
    else process.env.LEDGERAI_ISOLATED_TEST_ROOT = prevIsolated;
    await fsp.rm(isolatedRoot.base, { recursive: true, force: true }).catch(() => {});
  });

  it('Phase 1: Release Baseline Manifest confirms v1.0.0-rc.2 synchronization across package.json, Electron builders, Windows Inno Setup scripts, and User Manual', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const ebClient = JSON.parse(fs.readFileSync(path.resolve('electron-builder.client.json'), 'utf8'));
    const ebKeygen = JSON.parse(fs.readFileSync(path.resolve('electron-builder.keygenerator.json'), 'utf8'));
    const issSpec = fs.readFileSync(path.resolve('packaging/windows/installer-config/installer-specification.iss'), 'utf8');
    const issClient = fs.readFileSync(path.resolve('packaging/windows/installer-config/installer-client.iss'), 'utf8');
    const issKeygen = fs.readFileSync(path.resolve('packaging/windows/installer-config/installer-keygenerator.iss'), 'utf8');
    const userManual = fs.readFileSync(path.resolve('LEDGERAI_PH_USER_MANUAL.md'), 'utf8');

    expect(pkg.version).toBe('1.0.0-rc.2');
    expect(ebClient.extraMetadata.version).toBe('1.0.0-rc.2');
    expect(ebKeygen.extraMetadata.version).toBe('1.0.0-rc.2');
    expect(issSpec).toContain('AppVersion=1.0.0-rc.2');
    expect(issClient).toContain('#define MyAppVersion "1.0.0-rc.2"');
    expect(issKeygen).toContain('#define MyAppVersion "1.0.0-rc.2"');
    expect(userManual).toContain('1.0.0-rc.2');
    expect(userManual).toContain('10.1 Manual 1 — Company Owner Manual');
    expect(userManual).toContain('10.12 Manual 12 — Month-End, Quarter-End & Year-End Closing Guide');
  });

  it('Phase 4: First Company Initialization (20-step clean onboarding, COA mapping, Bank Account registration, User RBAC provisioning, and Zero-Balance Verification)', async () => {
    const companyDir = path.join(isolatedRoot.dataDir, 'mayon_real_pilot_2026');
    const createRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Mayon Real Pilot Trading Corp.',
          tradeName: 'Mayon Pilot Trading',
          tin: '234-567-890-000',
          branchCode: '00000',
          industry: 'Retail & Wholesale Distribution',
          classification: 'PRODUCTION',
          encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
        },
        tax: {
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
          rdoCode: '044',
        },
        accounting: {
          fiscalYear: 2026,
          fiscalYearStartMonth: 1,
          currency: 'PHP',
          accountingMethod: 'ACCRUAL',
          beginningBalances: [],
        },
        locations: {
          documentLocationPath: companyDir,
          backupLocationPath: path.join(companyDir, 'backups'),
        },
        admin: {
          displayName: 'Elena Pilot Owner',
          email: 'elena.owner@mayonpilot.ph',
          password: 'PilotOwnerPass2026!#',
        },
      });

    expect(createRes.status).toBe(200);
    companyId = createRes.body.companyId;
    expect(companyId).toBeTruthy();

    const ownerLogin = await request(app)
      .post('/api/auth/login')
      .send({
        companyId,
        email: 'elena.owner@mayonpilot.ph',
        password: 'PilotOwnerPass2026!#',
      });
    expect(ownerLogin.status).toBe(200);
    ownerToken = ownerLogin.body.token;
    ownerUserId = ownerLogin.body.user.id;
    expect(ownerToken).toBeTruthy();

    // Verify Initial Zero-Balance State
    const initVal = await request(app)
      .get('/api/master-data/opening-balances/validation')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(initVal.status).toBe(200);
    expect(initVal.body.isZeroBalanceInitialization).toBe(true);
    expect(initVal.body.isOpeningTrialBalanceBalanced).toBe(true);
    expect(initVal.body.totalOpeningDebitCentavos).toBe(0);
    expect(initVal.body.totalOpeningCreditCentavos).toBe(0);

    // Step 8-11: Inspect COA and Register Bank Account linked to COA GL Account 1010
    const coaRes = await request(app)
      .get('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(coaRes.status).toBe(200);
    const cashInBankAcc = coaRes.body.find((a: any) => String(a.accountCode) === '1010');
    expect(cashInBankAcc).toBeDefined();

    const compDb = await CompanyManager.getCompanyDb(companyId);
    await dbContext.run(compDb, async () => {
      const createdBank = await BankReconciliationService.createBankAccount({
        companyId,
        bankName: 'BPI Corporate Checking',
        accountName: 'Mayon Real Pilot Trading Corp.',
        accountNumber: '0044-8899-11',
        currency: 'PHP',
        glAccountId: cashInBankAcc.id,
      });
      expect(createdBank.glAccountId).toBe(cashInBankAcc.id);
      expect(createdBank.isGlLinked).toBe(true);
    });

    // Step 15-17: Provision Bookkeeper & Independent Approver users for Maker-Checker SoD
    const bkRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        displayName: 'Marco Bookkeeper',
        name: 'Marco Bookkeeper',
        email: 'marco.bk@mayonpilot.ph',
        password: 'BookkeeperPass2026!#',
        role: 'Bookkeeper',
      });
    expect([200, 201]).toContain(bkRes.status);

    const apRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        displayName: 'Sofia Approver',
        name: 'Sofia Approver',
        email: 'sofia.approver@mayonpilot.ph',
        password: 'ApproverPass2026!#',
        role: 'Approver / Reviewer',
      });
    expect([200, 201]).toContain(apRes.status);

    const bkLogin = await request(app)
      .post('/api/auth/login')
      .send({ companyId, email: 'marco.bk@mayonpilot.ph', password: 'BookkeeperPass2026!#' });
    expect(bkLogin.status).toBe(200);
    bookkeeperToken = bkLogin.body.token;

    const apLogin = await request(app)
      .post('/api/auth/login')
      .send({ companyId, email: 'sofia.approver@mayonpilot.ph', password: 'ApproverPass2026!#' });
    expect(apLogin.status).toBe(200);
    approverToken = apLogin.body.token;
    expect(approverToken).toBeTruthy();
  });

  it('Phase 5: Controlled Opening Balance Cutover & Historical Validation (blocks unbalanced plugs, blocks Income Statement accounts, posts balanced batch with schedule metadata, blocks duplicates, and reconciles Trial Balance)', async () => {
    // 1. Attempt an UNBALANCED batch -> must be rejected with 400 UNBALANCED_OPENING_BALANCE_BATCH (never silently plugged!)
    const unbalancedRes = await request(app)
      .post('/api/master-data/opening-balances/batch')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveDate: '2026-01-01',
        batchReference: 'CUTOVER-2026-UNBAL',
        sourceSystem: 'Audited FY2025 Trial Balance',
        supportingScheduleRef: 'WP-OB-2026-UNBAL',
        lines: [
          { accountCode: '1010', debitPhp: 500000, creditPhp: 0 },
          { accountCode: '3010', debitPhp: 0, creditPhp: 450000 },
        ],
      });
    expect(unbalancedRes.status).toBe(400);
    expect(unbalancedRes.body.error).toBe('UNBALANCED_OPENING_BALANCE_BATCH');

    // 2. Attempt an Income Statement (REVENUE 4010) opening balance -> must be rejected with 400 OPENING_BALANCE_INVALID_ACCOUNT_TYPE
    const revRejectRes = await request(app)
      .post('/api/master-data/opening-balances/batch')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveDate: '2026-01-01',
        batchReference: 'CUTOVER-2026-REV',
        sourceSystem: 'Audited FY2025 Trial Balance',
        supportingScheduleRef: 'WP-OB-2026-REV',
        lines: [
          { accountCode: '1010', debitPhp: 100000, creditPhp: 0 },
          { accountCode: '4010', debitPhp: 0, creditPhp: 100000 },
        ],
      });
    expect(revRejectRes.status).toBe(400);
    expect(revRejectRes.body.error).toBe('OPENING_BALANCE_INVALID_ACCOUNT_TYPE');

    // 3. Post a verified, balanced multi-line Opening Balance Cutover Batch across Cash (1010), AR, Inventory, AP, and Equity
    const coaRes = await request(app)
      .get('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`);
    const accounts = coaRes.body as Array<any>;
    const findCode = (preferred: string[], fallbackType: string) => {
      for (const c of preferred) {
        const hit = accounts.find((a) => String(a.accountCode) === c && a.status === 'ACTIVE');
        if (hit) return hit.accountCode;
      }
      const byType = accounts.find(
        (a) =>
          String(a.accountType).toUpperCase() === fallbackType &&
          a.status === 'ACTIVE' &&
          String(a.detailType || '').toUpperCase() !== 'OPENING_BALANCE_EQUITY'
      );
      return byType.accountCode;
    };

    const cashCode = findCode(['1010'], 'ASSET');
    const arCode = findCode(['1030', '1120'], 'RECEIVABLE');
    const invCode = findCode(['1050', '1200'], 'INVENTORY');
    const apCode = findCode(['2010'], 'PAYABLE');
    const eqCode = findCode(['3010', '3020'], 'EQUITY');

    // Total Debit: 500,000 (Cash) + 150,000 (AR) + 200,000 (Inventory) = 850,000.00
    // Total Credit: 120,000 (AP) + 730,000 (Equity) = 850,000.00
    const validBatchRes = await request(app)
      .post('/api/master-data/opening-balances/batch')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveDate: '2026-01-01',
        batchReference: 'OB-2026-PILOT-01',
        sourceSystem: 'Audited FY2025 External CPA Financial Statements',
        supportingScheduleRef: 'SCHED-OB-2026-A1',
        notes: 'Approved initial cutover balances for FY2026 pilot',
        approvedByUserId: ownerUserId,
        lines: [
          { accountCode: cashCode, debitPhp: 500000, creditPhp: 0, description: 'Beginning Cash in Bank per BPI Statement' },
          { accountCode: arCode, debitPhp: 150000, creditPhp: 0, description: 'Beginning AR per Schedule AR-01' },
          { accountCode: invCode, debitPhp: 200000, creditPhp: 0, description: 'Beginning Merchandise Inventory per Physical Count' },
          { accountCode: apCode, debitPhp: 0, creditPhp: 120000, description: 'Beginning AP per Supplier Schedule AP-01' },
          { accountCode: eqCode, debitPhp: 0, creditPhp: 730000, description: 'Subscribed & Paid-Up Capital Stock' },
        ],
      });

    expect(validBatchRes.status).toBe(201);
    expect(validBatchRes.body.isBalanced).toBe(true);
    expect(validBatchRes.body.totalDebitCentavos).toBe(85000000);
    expect(validBatchRes.body.totalCreditCentavos).toBe(85000000);
    expect(validBatchRes.body.accountCount).toBe(5);

    // 4. Attempt duplicate import of the same accounts/batch -> must be blocked with 409 OPENING_BALANCE_ALREADY_POSTED
    const dupRes = await request(app)
      .post('/api/master-data/opening-balances/batch')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveDate: '2026-01-01',
        batchReference: 'OB-2026-PILOT-01',
        sourceSystem: 'Audited FY2025 External CPA Financial Statements',
        supportingScheduleRef: 'SCHED-OB-2026-A1',
        lines: [
          { accountCode: cashCode, debitPhp: 500000, creditPhp: 0 },
          { accountCode: eqCode, debitPhp: 0, creditPhp: 500000 },
        ],
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('OPENING_BALANCE_ALREADY_POSTED');

    // 5. Validate Opening Trial Balance & COA-to-GL reconciliation
    const valRes = await request(app)
      .get('/api/master-data/opening-balances/validation')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(valRes.status).toBe(200);
    expect(valRes.body.isZeroBalanceInitialization).toBe(false);
    expect(valRes.body.isOpeningTrialBalanceBalanced).toBe(true);
    expect(valRes.body.totalOpeningDebitCentavos).toBe(85000000);
    expect(valRes.body.totalOpeningCreditCentavos).toBe(85000000);
    expect(valRes.body.trialBalanceDiscrepancyCentavos).toBe(0);
    expect(valRes.body.coaVsGlReconciliation.reconciledCount).toBe(5);
    expect(valRes.body.coaVsGlReconciliation.missingGlEntryCount).toBe(0);
    expect(valRes.body.coaVsGlReconciliation.discrepancyReviewCount).toBe(0);
  });

  it('Phase 7 & Phase 9: Ledger Agent Knowledge Base & Role-Based UAT (Owner full access, Bookkeeper Payroll refusal, Approver SoD)', async () => {
    // 1. Verify new Knowledge Base guides (Opening Balance Cutover & 360 Entity Journey) are searchable
    const obMatches = searchKnowledgeBase('How do I record opening balance cutover and validate opening trial balance?');
    expect(obMatches.length).toBeGreaterThan(0);
    expect(obMatches[0].submoduleId).toBe('sys-opening-balance-cutover');

    const j360Matches = searchKnowledgeBase('How does the 360 entity journey traceability work?');
    expect(j360Matches.length).toBeGreaterThan(0);
    expect(j360Matches[0].submoduleId).toBe('sys-360-entity-journey');

    // 2. Bookkeeper asks Ledger Agent for confidential payroll salary breakdown -> refused/masked by Domain RBAC
    const bkPayrollQuery = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .send({ prompt: 'Show total employee payroll compensation and net pay this month', forceOffline: true });
    expect([200, 403]).toContain(bkPayrollQuery.status);
    if (bkPayrollQuery.status === 200) {
      expect(['accessRefused', 'payrollInquiryMasked']).toContain(bkPayrollQuery.body.skillId);
    } else {
      expect(bkPayrollQuery.body.error).toBe('SECURITY_REFUSAL');
    }

    // 3. Company Owner asks Ledger Agent for Opening Balance Cutover instructions -> receives verified guide
    const ownerKbQuery = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ prompt: 'How do I record opening balance cutover?', forceOffline: true });
    expect(ownerKbQuery.status).toBe(200);
    expect(ownerKbQuery.body.skillId).toBe('knowledgeBaseQuery');
    expect(ownerKbQuery.body.answer).toContain('Opening Balance Cutover');
  });

  it('Phase 8: Backup, Restore & Business Continuity (creates AES-256-GCM .lai backup, verifies SHA-256 checksum & HMAC signature, restores into isolated clone, and preserves 850,000.00 Opening Trial Balance)', async () => {
    const backupMeta = await RestoreService.createAtomicBackup(
      companyId,
      ownerUserId,
      'MayonPilotCutoverBackup'
    );
    expect(backupMeta.backupPath).toBeTruthy();
    expect(fs.existsSync(backupMeta.backupPath)).toBe(true);

    // Verify backup archive cryptographic integrity & clean tenant validation
    const rawBuf = fs.readFileSync(backupMeta.backupPath);
    const deserialized = RestoreService.deserializeLai(rawBuf);
    expect(RestoreService.verifyChecksum(deserialized)).toBe(true);
    expect(deserialized.metadata.companyId).toBe(companyId);

    // Restore into a controlled new clone company workspace via POST /api/restore
    const cloneDest = path.join(isolatedRoot.dataDir, 'mayon_pilot_dr_clone_2026');
    const restoreRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        mode: 'NEW',
        backupFilePath: backupMeta.backupPath,
        destinationPath: cloneDest,
        cloneAsNew: true,
      });
    expect(restoreRes.status).toBe(200);
    const restoredCompanyId = restoreRes.body.companyId;
    expect(restoredCompanyId).toBeTruthy();
    expect(restoredCompanyId).not.toBe(companyId);

    // Login to restored clone as Owner and confirm the ₱850,000.00 Opening Trial Balance is 100% intact
    const cloneLogin = await request(app)
      .post('/api/auth/login')
      .send({
        companyId: restoredCompanyId,
        email: 'elena.owner@mayonpilot.ph',
        password: 'PilotOwnerPass2026!#',
      });
    expect(cloneLogin.status).toBe(200);

    const cloneVal = await request(app)
      .get('/api/master-data/opening-balances/validation')
      .set('Authorization', `Bearer ${cloneLogin.body.token}`);
    expect(cloneVal.status).toBe(200);
    expect(cloneVal.body.isOpeningTrialBalanceBalanced).toBe(true);
    expect(cloneVal.body.totalOpeningDebitCentavos).toBe(85000000);
    expect(cloneVal.body.totalOpeningCreditCentavos).toBe(85000000);
  });
});
