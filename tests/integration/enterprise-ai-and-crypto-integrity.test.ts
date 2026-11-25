import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import request from 'supertest';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  ORIGINAL_DESKGUARD_LAI_PATH,
  PREVIEW_COMPANY_ID,
  PREVIEW_COMPANY_DIR,
  seedDeskguardStressPreview,
} from '../../src/server/scripts/seedDeskguardStressPreview';
import { EnterpriseAiAgentService } from '../../src/server/services/enterpriseAiAgentService';

const ORIGINAL_DESKGUARD_EXPECTED_SHA256 =
  '1350910f1af35db1c12214dc50a5100483af7dfac25aeb0938a5109a69070b67';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('Enterprise AI Agent (REQ-AI-ENTERPRISE-001 & REQ-AI-OFFLINE-001) & Cryptographic Ledger Integrity (REQ-CRYPTO-LEDGER-001 & REQ-OFFLINE-INTEGRITY-001)', () => {
  let app: any;
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerToken: string;
  let auditorToken: string;
  let restrictedUserToken: string;
  const restrictedUserId = 'usr-dg-clerk';
  let sampleAccountDebitId: string;
  let sampleAccountCreditId: string;

  before(async () => {
    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      const preHash = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      assert.equal(
        preHash,
        ORIGINAL_DESKGUARD_EXPECTED_SHA256,
        'Original Deskguard Solutions database.lai must remain unmodified before tests'
      );
    }

    const activePath = path.join(PREVIEW_COMPANY_DIR, '.db_active.sqlite');
    const laiPath = path.join(PREVIEW_COMPANY_DIR, 'database.lai');
    const markerPath = path.join(PREVIEW_COMPANY_DIR, '.seeded_complete');
    if ((!fs.existsSync(activePath) && !fs.existsSync(laiPath)) || !fs.existsSync(markerPath)) {
      await seedDeskguardStressPreview();
    }

    const targetDbPath = fs.existsSync(activePath) ? activePath : laiPath;
    sqlite = new Database(targetDbPath);
    db = drizzle(sqlite, { schema });

    try {
      const manifestPath = path.join(PREVIEW_COMPANY_DIR, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        await CompanyManager.registerCompany(manifest);
      }
    } catch (_) {}

    const { createApp } = await import('../../src/server/app');
    app = createApp();

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresSec = nowSec + 86400;

    // 1. Owner Session
    const ownerSessionId = crypto.randomBytes(32).toString('hex');
    const hashedOwnerSession = crypto.createHash('sha256').update(ownerSessionId).digest('hex');
    ownerToken = `${PREVIEW_COMPANY_ID}.${ownerSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-owner', ?, ?)`
      )
      .run(hashedOwnerSession, expiresSec, nowSec);

    // 2. Auditor Session
    const auditorSessionId = crypto.randomBytes(32).toString('hex');
    const hashedAuditorSession = crypto.createHash('sha256').update(auditorSessionId).digest('hex');
    auditorToken = `${PREVIEW_COMPANY_ID}.${auditorSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-auditor', ?, ?)`
      )
      .run(hashedAuditorSession, expiresSec, nowSec);

    // 3. Restricted Test User Session (usr-dg-clerk — Bookkeeper role: has ai:inquiry, lacks payroll:view, ai:config, audit:integrity:scan)
    const restrictedSessionId = crypto.randomBytes(32).toString('hex');
    const hashedRestrictedSession = crypto.createHash('sha256').update(restrictedSessionId).digest('hex');
    restrictedUserToken = `${PREVIEW_COMPANY_ID}.${restrictedSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(hashedRestrictedSession, restrictedUserId, expiresSec, nowSec);

    const accounts = db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, PREVIEW_COMPANY_ID),
          eq(schema.accounts.status, 'ACTIVE')
        )
      )
      .all();
    const cashAcc = accounts.find((a) => a.accountType === 'ASSET') || accounts[0];
    const revAcc = accounts.find((a) => a.accountType === 'REVENUE') || accounts[1];
    sampleAccountDebitId = cashAcc.id;
    sampleAccountCreditId = revAcc.id;
  });

  after(() => {
    try {
      sqlite.prepare(`DELETE FROM user_permission_overrides WHERE id IN ('ovr-deny-ai-inq', 'ovr-deny-audit-scan')`).run();
      // Reset AI settings to clean default state
      sqlite
        .prepare(
          `UPDATE company_ai_settings
           SET primary_key_id = 'system_default',
               secondary_key_id = 'offline_local',
               custom_keys_json = '[]',
               providers_config_json = '[]',
               execution_mode_override = 'AUTO'
           WHERE company_id = ?`
        )
        .run(PREVIEW_COMPANY_ID);
    } catch (_) {}

    if (sqlite) {
      sqlite.close();
    }

    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      const postHash = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      assert.equal(
        postHash,
        ORIGINAL_DESKGUARD_EXPECTED_SHA256,
        'Original Deskguard Solutions database.lai must remain unmodified after test execution'
      );
    }
  });

  // ============================================================================
  // WORKSTREAM A — ENTERPRISE LEDGER AGENT AI TESTS
  // ============================================================================

  it('A1: encrypts API keys at rest with AES-256-GCM (LAIAIKEY1:) and never exposes plaintext keys via GET /api/ai/settings', async () => {
    const rawSecret = 'sk-enterprise-secret-key-9876543210';
    const encrypted = EnterpriseAiAgentService.encryptApiKey(PREVIEW_COMPANY_ID, rawSecret);
    assert.ok(encrypted.startsWith('LAIAIKEY1:'), 'Encrypted key must start with LAIAIKEY1: envelope');
    assert.ok(!encrypted.includes(rawSecret), 'Encrypted payload must not contain raw secret');
    const decrypted = EnterpriseAiAgentService.decryptApiKey(PREVIEW_COMPANY_ID, encrypted);
    assert.equal(decrypted, rawSecret, 'Decrypted key must match original raw secret');
    const masked = EnterpriseAiAgentService.maskApiKey(rawSecret);
    assert.ok(!masked.includes('enterprise-secret'), 'Masked key must conceal middle characters');
    assert.ok(masked.endsWith('3210'), 'Masked key must preserve last 4 characters');

    // Save custom keys via POST /api/ai/settings
    const saveRes = await request(app)
      .post('/api/ai/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        primaryKeyId: 'key-primary-1',
        secondaryKeyId: 'offline_local',
        executionModeOverride: 'AUTO',
        customKeys: [
          {
            id: 'key-primary-1',
            name: 'Corporate Primary Gemini',
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            apiKey: rawSecret,
            priorityOrder: 1,
            enabled: true,
          },
        ],
      });

    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.success, true);

    // Verify GET /api/ai/settings returns maskedKey and never exposes plaintext key
    const getRes = await request(app)
      .get('/api/ai/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);

    assert.equal(getRes.status, 200);
    const responseText = JSON.stringify(getRes.body);
    assert.ok(!responseText.includes(rawSecret), 'GET /api/ai/settings must never return plaintext secret');
    assert.ok(!responseText.includes('LAIAIKEY1:'), 'GET /api/ai/settings must not expose raw ciphertext envelope');
    assert.equal(getRes.body.customKeys.length, 1);
    assert.ok(getRes.body.customKeys[0].maskedKey.endsWith('3210'));

    // Verify raw SQLite row is encrypted at rest
    const dbRow = sqlite
      .prepare(`SELECT custom_keys_json, providers_config_json FROM company_ai_settings WHERE company_id = ?`)
      .get(PREVIEW_COMPANY_ID) as any;
    assert.ok(dbRow.providers_config_json.includes('LAIAIKEY1:'), 'SQLite providers_config_json must store encrypted LAIAIKEY1: token');
    assert.ok(!dbRow.providers_config_json.includes(rawSecret), 'SQLite providers_config_json must not store plaintext secret');
    assert.ok(!dbRow.custom_keys_json.includes(rawSecret), 'SQLite custom_keys_json must not store plaintext secret');
  });

  it('A2: tests provider connection health and classifies invalid/timeout/rate-limit credentials deterministically', async () => {
    // Configure test keys for invalid, rate-limit, and timeout scenarios
    await request(app)
      .post('/api/ai/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        primaryKeyId: 'offline_local',
        secondaryKeyId: 'offline_local',
        customKeys: [
          {
            id: 'key-invalid',
            name: 'Invalid Gemini Key',
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            apiKey: 'invalid_key_1234567890',
            enabled: true,
          },
          {
            id: 'key-ratelimit',
            name: 'Rate Limited OpenAI Key',
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            apiKey: 'sk-RATE_LIMIT_429_KEY_12345',
            enabled: true,
          },
          {
            id: 'key-timeout',
            name: 'Timeout Key',
            provider: 'grok',
            modelId: 'grok-2-latest',
            apiKey: 'xai-TIMEOUT_KEY_1234567890',
            enabled: true,
          },
        ],
      });

    // 1. Offline engine test
    const offlineTest = await request(app)
      .post('/api/ai/providers/test')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        providerId: 'offline_local',
      });
    assert.equal(offlineTest.status, 200);
    assert.equal(offlineTest.body.success, true);
    assert.equal(offlineTest.body.status, 'OFFLINE_READY');

    // 2. Invalid key classification
    const invalidTest = await request(app)
      .post('/api/ai/providers/test')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        providerId: 'key-invalid',
      });
    assert.equal(invalidTest.status, 200);
    assert.equal(invalidTest.body.success, false);
    assert.equal(invalidTest.body.failureClassification, 'INVALID_CREDENTIAL');

    // 3. Rate limit key classification
    const rateLimitTest = await request(app)
      .post('/api/ai/providers/test')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        providerId: 'key-ratelimit',
      });
    assert.equal(rateLimitTest.status, 200);
    assert.equal(rateLimitTest.body.success, false);
    assert.equal(rateLimitTest.body.failureClassification, 'RATE_LIMIT');

    // 4. Timeout key classification
    const timeoutTest = await request(app)
      .post('/api/ai/providers/test')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        providerId: 'key-timeout',
      });
    assert.equal(timeoutTest.status, 200);
    assert.equal(timeoutTest.body.success, false);
    assert.equal(timeoutTest.body.failureClassification, 'TIMEOUT');
  });

  it('A3: executes deterministic multi-provider failover (Invalid Primary -> Secondary Online Provider, and Invalid Primary -> Rate-Limited Secondary -> Local Offline Engine)', async () => {
    // Case 1: Invalid Primary -> Valid Secondary Online Provider
    await request(app)
      .post('/api/ai/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        primaryKeyId: 'key-bad-primary',
        secondaryKeyId: 'key-good-secondary',
        executionModeOverride: 'AUTO',
        customKeys: [
          {
            id: 'key-bad-primary',
            name: 'Broken Primary Key',
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            apiKey: 'invalid_key_primary_001234',
            priorityOrder: 1,
            enabled: true,
          },
          {
            id: 'key-good-secondary',
            name: 'Valid Secondary Key',
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            apiKey: 'VALID_TEST_KEY_SECONDARY_9999',
            priorityOrder: 2,
            enabled: true,
          },
        ],
      });

    const secondaryFailoverRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'Magkano kinita ko this month?',
      });

    assert.equal(secondaryFailoverRes.status, 200);
    assert.equal(secondaryFailoverRes.body.provenance.failoverOccurred, true);
    assert.equal(secondaryFailoverRes.body.provenance.executionMode, 'ONLINE_GROUNDED');
    assert.equal(secondaryFailoverRes.body.provenance.providerId, 'key-good-secondary');
    assert.ok(
      secondaryFailoverRes.body.provenance.failoverReason.includes('INVALID_CREDENTIAL'),
      'Failover reason must record INVALID_CREDENTIAL on primary'
    );

    // Case 2: Invalid Primary -> Rate-Limited Secondary -> Local Deterministic Offline Engine
    await request(app)
      .post('/api/ai/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        primaryKeyId: 'key-bad-primary',
        secondaryKeyId: 'key-ratelimit-secondary',
        executionModeOverride: 'AUTO',
        customKeys: [
          {
            id: 'key-bad-primary',
            name: 'Broken Primary Key',
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            apiKey: 'invalid_key_primary_001234',
            priorityOrder: 1,
            enabled: true,
          },
          {
            id: 'key-ratelimit-secondary',
            name: 'Rate Limited Secondary',
            provider: 'openai',
            modelId: 'gpt-4o-mini',
            apiKey: 'RATE_LIMIT_429_SECONDARY_KEY',
            priorityOrder: 2,
            enabled: true,
          },
        ],
      });

    const offlineFallbackRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'Show Trial Balance summary',
      });

    assert.equal(offlineFallbackRes.status, 200);
    assert.equal(offlineFallbackRes.body.provenance.failoverOccurred, true);
    assert.equal(offlineFallbackRes.body.provenance.executionMode, 'FAILOVER_OFFLINE');
    assert.equal(offlineFallbackRes.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
    assert.equal(offlineFallbackRes.body.provenance.failoverTrace.length, 3);
    assert.equal(offlineFallbackRes.body.provenance.failoverTrace[0].failureClassification, 'INVALID_CREDENTIAL');
    assert.equal(offlineFallbackRes.body.provenance.failoverTrace[1].failureClassification, 'RATE_LIMIT');
    assert.equal(offlineFallbackRes.body.provenance.failoverTrace[2].outcome, 'SUCCESS');
    assert.ok(offlineFallbackRes.body.answer.includes('Trial Balance Summary'));
  });

  it('A4: operates 100% offline with real persisted SQLite data across GL, Trial Balance, AR/AP, Inventory, Tax/BIR, and Period Close queries', async () => {
    const queries = [
      {
        q: 'Magkano kinita ko this month?',
        expectedSubstring: 'Revenue, Expense & Net Income Summary',
        expectedTable: 'journal_entries',
      },
      {
        q: 'Show Trial Balance summary',
        expectedSubstring: 'Trial Balance Summary',
        expectedTable: 'journal_lines',
      },
      {
        q: 'May utang ba mga customer at supplier?',
        expectedSubstring: 'Accounts Receivable (AR) & Accounts Payable (AP) Summary',
        expectedTable: 'sales_invoices',
      },
      {
        q: 'Check inventory stock valuation and low stock items',
        expectedSubstring: 'Inventory Quantities & Valuation Summary',
        expectedTable: 'inventory_items',
      },
      {
        q: 'Magkano VAT ko at kailan BIR filing deadline?',
        expectedSubstring: 'Philippine Tax & BIR Statutory Computation',
        expectedTable: 'tax_filings',
      },
      {
        q: 'Show accounting period close status and certifications',
        expectedSubstring: 'Accounting Period & Close Certification Status',
        expectedTable: 'accounting_periods',
      },
    ];

    for (const item of queries) {
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({
          prompt: item.q,
          forceOffline: true,
        });

      assert.equal(res.status, 200, `Offline query failed for: ${item.q}`);
      assert.ok(
        res.body.answer.includes(item.expectedSubstring),
        `Expected "${item.expectedSubstring}" in answer for "${item.q}", got: ${res.body.answer.slice(0, 180)}`
      );
      assert.equal(res.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
      assert.equal(res.body.provenance.companyId, PREVIEW_COMPANY_ID);
      assert.equal(res.body.provenance.confidenceState, 'VERIFIED_AUTHORITATIVE');
      assert.ok(
        res.body.provenance.dataSource.includes(item.expectedTable),
        `Expected dataSource to include ${item.expectedTable}`
      );
      assert.ok(Array.isArray(res.body.provenance.sourceRecords), 'sourceRecords must be an array');
    }
  });

  it('A5: handles unknown/unsupported queries safely without hallucinating numbers and enforces RBAC compensation masking & explicit DENY', async () => {
    // 1. Unknown query in offline mode
    const unknownRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'What is the weather forecast on Mars next Tuesday?',
        forceOffline: true,
      });

    assert.equal(unknownRes.status, 200);
    assert.equal(unknownRes.body.provenance.confidenceState, 'INSUFFICIENT_DATA');
    assert.ok(unknownRes.body.answer.includes('Supported Local Offline Inquiries'));

    // 2. Sensitive Payroll query by restricted user (SALES_CLERK lacks payroll:view and ai:inquiry:sensitive)
    const maskedPayrollRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${restrictedUserToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'Show payroll summary and employee salaries',
        forceOffline: true,
      });

    assert.equal(maskedPayrollRes.status, 200);
    assert.equal(maskedPayrollRes.body.skillId, 'payrollInquiryMasked');
    assert.ok(maskedPayrollRes.body.answer.includes('Sensitive Payroll & Compensation Masking Active'));

    // 3. Sensitive Payroll query by Owner (has payroll:view) shows exact figures
    const ownerPayrollRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'Show payroll summary and employee salaries',
        forceOffline: true,
      });

    assert.equal(ownerPayrollRes.status, 200);
    assert.equal(ownerPayrollRes.body.skillId, 'payrollSummary');
    assert.ok(ownerPayrollRes.body.answer.includes('Total Gross Compensation'));

    // 4. Explicit DENY on ai:inquiry blocks access with 403
    const nowSec = Math.floor(Date.now() / 1000);
    const clerkCu = sqlite
      .prepare(`SELECT id FROM company_users WHERE company_id = ? AND user_id = ? LIMIT 1`)
      .get(PREVIEW_COMPANY_ID, restrictedUserId) as { id: string };
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO user_permission_overrides (id, company_user_id, permission_code, effect, reason, created_at)
         VALUES ('ovr-deny-ai-inq', ?, 'ai:inquiry', 'DENY', 'Test explicit deny on AI inquiry', ?)`
      )
      .run(clerkCu.id, nowSec);

    const deniedAiRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${restrictedUserToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        prompt: 'Magkano kinita ko this month?',
        forceOffline: true,
      });

    assert.equal(deniedAiRes.status, 403, 'Explicit DENY on ai:inquiry must return 403');
    sqlite.prepare(`DELETE FROM user_permission_overrides WHERE id = 'ovr-deny-ai-inq'`).run();

    // 5. Restricted user cannot modify AI settings (lacks ai:config / ai:keys:manage)
    const deniedSettingsRes = await request(app)
      .post('/api/ai/settings')
      .set('Authorization', `Bearer ${restrictedUserToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({
        primaryKeyId: 'offline_local',
      });
    assert.equal(deniedSettingsRes.status, 403, 'User without ai:config must be rejected with 403');
  });

  // ============================================================================
  // WORKSTREAM B — CRYPTOGRAPHIC LEDGER INTEGRITY TESTS
  // ============================================================================

  it('B1 & B2: loads integrity overview and executes a 100% offline 3-domain integrity scan on LGR-PH-2026-STRESS-DG-PREVIEW', async () => {
    try {
      sqlite.prepare(`DELETE FROM integrity_scan_findings WHERE company_id = ?`).run(PREVIEW_COMPANY_ID);
      sqlite.prepare(`DELETE FROM integrity_scan_reports WHERE company_id = ?`).run(PREVIEW_COMPANY_ID);
    } catch (_) {}

    // 1. Overview endpoint works without error (returns NOT_SCANNED cleanly when no scans exist)
    const overviewRes = await request(app)
      .get('/api/audit/integrity/overview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);

    assert.equal(overviewRes.status, 200);
    assert.equal(overviewRes.body.companyId, PREVIEW_COMPANY_ID);
    assert.equal(overviewRes.body.executionMode, 'OFFLINE_LOCAL');
    assert.equal(overviewRes.body.lifecycleStatus, 'NOT_SCANNED');

    // 2. Execute full 3-domain scan
    const scanRes = await request(app)
      .post('/api/audit/integrity/scan')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({});

    assert.equal(scanRes.status, 200);
    assert.ok(scanRes.body.scanId, 'Scan report must have a persisted scanId');
    assert.equal(scanRes.body.companyId, PREVIEW_COMPANY_ID);
    assert.equal(scanRes.body.executionMode, 'OFFLINE_LOCAL');
    assert.ok(scanRes.body.recordsInspected.totalRecordsInspected >= 10000, 'Must inspect >= 10,000 records');
    assert.ok(scanRes.body.reportHash && scanRes.body.reportHash.length === 64, 'Must compute 64-char SHA-256 reportHash');

    // Verify all 3 domains exist with expected checks
    const domains = scanRes.body.domains;
    assert.ok(domains.ACCOUNTING_INTEGRITY, 'Must include ACCOUNTING_INTEGRITY domain');
    assert.ok(domains.RECORD_INTEGRITY, 'Must include RECORD_INTEGRITY domain');
    assert.ok(domains.CRYPTOGRAPHIC_INTEGRITY, 'Must include CRYPTOGRAPHIC_INTEGRITY domain');
    assert.equal(domains.ACCOUNTING_INTEGRITY.totalChecks, 5);
    assert.equal(domains.RECORD_INTEGRITY.totalChecks, 5);
    assert.equal(domains.CRYPTOGRAPHIC_INTEGRITY.totalChecks, 4);

    // Verify clean pass on baseline stress dataset
    assert.equal(scanRes.body.status, 'COMPLETED');
    assert.equal(scanRes.body.findingsCount, 0, `Expected 0 findings on clean baseline, got: ${JSON.stringify(scanRes.body.findings)}`);
  });

  it('B3 & B4: detects injected Accounting, Record, and Cryptographic tampering anomalies and verifies clean remediation after rollback', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const badJournalId = 'je-tamper-test-unbalanced';
    const badLineId = 'jl-tamper-test-unbalanced';
    const orphanLineId = 'jl-tamper-test-orphan';
    const dupJournalA = 'je-tamper-dup-a';
    const dupJournalB = 'je-tamper-dup-b';
    const crossCompanyJournalId = 'je-tamper-cross-company';
    const badCertId = 'pcc-tamper-test-cert';
    const badDocId = 'doc-tamper-test-laisdoc1';
    const badDocPath = path.join(PREVIEW_COMPANY_DIR, 'tampered_test_container.laisdoc1');

    // Find an existing period ID for certification tampering check
    const existingPeriod = sqlite
      .prepare(`SELECT id FROM accounting_periods WHERE company_id = ? LIMIT 1`)
      .get(PREVIEW_COMPANY_ID) as { id: string } | undefined;
    const periodId = existingPeriod?.id || 'per-dg-2026-01';

    try {
      sqlite.pragma('foreign_keys = OFF');

      // 1. Inject Unbalanced Posted Journal Entry (Debit 5000, Credit 0)
      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, status, created_by, created_at, updated_at)
           VALUES (?, ?, 'JE-TAMPER-UNBAL-001', '2026-10-15', 'Simulated unbalanced journal entry', 'POSTED', 'usr-dg-owner', ?, ?)`
        )
        .run(badJournalId, PREVIEW_COMPANY_ID, nowSec, nowSec);
      sqlite
        .prepare(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
           VALUES (?, ?, ?, 'Unbalanced debit line', 500000, 0, 1, ?)`
        )
        .run(badLineId, badJournalId, sampleAccountDebitId, nowSec);

      // 2. Inject Orphaned Journal Line (points to non-existent journal_entry_id)
      sqlite
        .prepare(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
           VALUES (?, 'je-non-existent-parent-999', ?, 'Orphaned line item', 10000, 0, 1, ?)`
        )
        .run(orphanLineId, sampleAccountDebitId, nowSec);

      // 3. Inject Duplicate Posted Journal Number
      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, status, created_by, created_at, updated_at)
           VALUES (?, ?, 'JE-DUP-REF-9999', '2026-10-15', 'Dup A', 'POSTED', 'usr-dg-owner', ?, ?),
                  (?, ?, 'JE-DUP-REF-9999', '2026-10-15', 'Dup B', 'POSTED', 'usr-dg-owner', ?, ?)`
        )
        .run(dupJournalA, PREVIEW_COMPANY_ID, nowSec, nowSec, dupJournalB, PREVIEW_COMPANY_ID, nowSec, nowSec);
      sqlite
        .prepare(
          `INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, line_number, created_at)
           VALUES ('jl-dup-a1', ?, ?, 10000, 0, 1, ?), ('jl-dup-a2', ?, ?, 0, 10000, 2, ?),
                  ('jl-dup-b1', ?, ?, 10000, 0, 1, ?), ('jl-dup-b2', ?, ?, 0, 10000, 2, ?)`
        )
        .run(
          dupJournalA, sampleAccountDebitId, nowSec,
          dupJournalA, sampleAccountCreditId, nowSec,
          dupJournalB, sampleAccountDebitId, nowSec,
          dupJournalB, sampleAccountCreditId, nowSec
        );

      // 4. Inject Cross-Company Contamination Record
      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, status, created_by, created_at, updated_at)
           VALUES (?, 'ROGUE-FOREIGN-COMPANY-ID', 'JE-ROGUE-001', '2026-10-15', 'Cross-company record', 'DRAFT', 'usr-dg-owner', ?, ?)`
        )
        .run(crossCompanyJournalId, nowSec, nowSec);

      // 5. Inject Tampered Period Close Certification SHA-256
      sqlite
        .prepare(
          `INSERT INTO period_close_certifications (
             id, company_id, period_id, period_name, start_date, end_date, fiscal_year,
             close_type, checklist_results_json, financial_overview_json, trial_balance_totals_json,
             unresolved_exceptions_json, closing_reason, reconciliation_refs_json,
             closed_by_user_id, closed_by_user_name, closed_by_user_role,
             closed_at, closing_policy_version, sha256_hash, created_at
           ) VALUES (
             ?, ?, ?, 'TAMPERED-PERIOD', '2026-10-01', '2026-10-31', 2026,
             'HARD_CLOSE', '[]', '{}', '{}',
             '[]', 'Simulated tampered close', '{}',
             'usr-dg-owner', 'Owner', 'Company Owner',
             '2026-10-31T23:59:59.000Z', 1, '0000000000000000000000000000000000000000000000000000000000000000', ?
           )`
        )
        .run(badCertId, PREVIEW_COMPANY_ID, periodId, nowSec);

      // 6. Inject Corrupted LAISDOC1 Container Document
      fs.writeFileSync(badDocPath, Buffer.concat([Buffer.from('LAISDOC1', 'ascii'), crypto.randomBytes(64)]));
      sqlite
        .prepare(
          `INSERT INTO documents (
             id, company_id, entity_type, entity_id, document_type, file_name, file_type,
             file_size, file_hash, file_path, uploaded_by, status, encryption_status, created_at, updated_at
           ) VALUES (
             ?, ?, 'GENERAL', 'gen-1', 'GENERAL_ATTACHMENT', 'tampered_test_container.pdf', 'application/pdf',
             72, '1111111111111111111111111111111111111111111111111111111111111111', ?, 'usr-dg-owner', 'ACTIVE', 'ENCRYPTED_AES256_GCM', ?, ?
           )`
        )
        .run(badDocId, PREVIEW_COMPANY_ID, badDocPath, nowSec, nowSec);

      // Run Integrity Scan and verify all injected anomalies are caught!
      const anomalyScanRes = await request(app)
        .post('/api/audit/integrity/scan')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({});

      assert.equal(anomalyScanRes.status, 200);
      assert.equal(anomalyScanRes.body.status, 'COMPLETED_WITH_FINDINGS');
      assert.ok(anomalyScanRes.body.findingsCount >= 6, `Expected at least 6 findings, got ${anomalyScanRes.body.findingsCount}`);

      const findingCodes = new Set(anomalyScanRes.body.findings.map((f: any) => f.checkCode));
      assert.ok(findingCodes.has('ACC_01_JOURNAL_DR_CR_BALANCE'), 'Must detect unbalanced journal entry');
      assert.ok(findingCodes.has('REC_01_ORPHANED_JOURNAL_LINES'), 'Must detect orphaned journal line');
      assert.ok(findingCodes.has('REC_03_DUPLICATE_POSTING_REFERENCES'), 'Must detect duplicate journal numbers');
      assert.ok(findingCodes.has('REC_04_COMPANY_ISOLATION_BOUNDARY'), 'Must detect cross-company record contamination');
      assert.ok(findingCodes.has('CRY_01_PERIOD_CLOSE_CERTIFICATION_SHA256'), 'Must detect tampered Period Close SHA-256 digest');
      assert.ok(findingCodes.has('CRY_03_LAISDOC1_AES256_GCM_ENVELOPE'), 'Must detect tampered LAISDOC1 AES-256-GCM container');
    } finally {
      // Clean up all injected anomalies
      sqlite.prepare(`DELETE FROM journal_lines WHERE id IN (?, ?, 'jl-dup-a1', 'jl-dup-a2', 'jl-dup-b1', 'jl-dup-b2')`).run(badLineId, orphanLineId);
      sqlite.prepare(`DELETE FROM journal_entries WHERE id IN (?, ?, ?, ?)`).run(badJournalId, dupJournalA, dupJournalB, crossCompanyJournalId);
      // Temporarily drop immutable delete trigger to clean up synthetic test certification row, then restore trigger
      sqlite.exec(`DROP TRIGGER IF EXISTS trg_period_close_cert_no_delete;`);
      sqlite.prepare(`DELETE FROM period_close_certifications WHERE id = ?`).run(badCertId);
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_period_close_cert_no_delete
        BEFORE DELETE ON period_close_certifications
        BEGIN
          SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be deleted.');
        END;
      `);
      sqlite.prepare(`DELETE FROM documents WHERE id = ?`).run(badDocId);
      sqlite.pragma('foreign_keys = ON');
      if (fs.existsSync(badDocPath)) {
        fs.unlinkSync(badDocPath);
      }
    }

    // Re-run scan to prove clean restoration and hash-chain linkage
    const cleanScanRes = await request(app)
      .post('/api/audit/integrity/scan')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({});

    assert.equal(cleanScanRes.status, 200);
    assert.equal(cleanScanRes.body.status, 'COMPLETED');
    assert.equal(cleanScanRes.body.findingsCount, 0);
    assert.ok(cleanScanRes.body.previousReportHash, 'Subsequent scan report must link to previousReportHash');
    assert.equal(cleanScanRes.body.hashChainVerified, true);
  });

  it('B5 & C2: exports persisted scan reports in JSON and CSV formats and enforces RBAC permissions (audit:integrity:scan, view, export)', async () => {
    const overviewRes = await request(app)
      .get('/api/audit/integrity/overview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);

    assert.equal(overviewRes.status, 200);
    const latestScanId = overviewRes.body.latestReport.scanId;
    assert.ok(latestScanId);

    // 1. JSON Export
    const jsonExportRes = await request(app)
      .get(`/api/audit/integrity/scans/${latestScanId}/export?format=json`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(jsonExportRes.status, 200);
    assert.equal(jsonExportRes.body.scanId, latestScanId);

    // 2. CSV Export
    const csvExportRes = await request(app)
      .get(`/api/audit/integrity/scans/${latestScanId}/export?format=csv`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(csvExportRes.status, 200);
    assert.ok(csvExportRes.text.includes('LEDGERAI PH — CRYPTOGRAPHIC LEDGER INTEGRITY REPORT'));

    // 3. Restricted user (SALES_CLERK role) lacks audit:integrity:scan and audit:integrity:view
    const forbiddenViewRes = await request(app)
      .get('/api/audit/integrity/overview')
      .set('Authorization', `Bearer ${restrictedUserToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(forbiddenViewRes.status, 403);

    const forbiddenScanRes = await request(app)
      .post('/api/audit/integrity/scan')
      .set('Authorization', `Bearer ${restrictedUserToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(forbiddenScanRes.status, 403);

    // 4. Auditor has audit:integrity:view and audit:integrity:scan, unless explicitly denied
    const auditorViewRes = await request(app)
      .get('/api/audit/integrity/overview')
      .set('Authorization', `Bearer ${auditorToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(auditorViewRes.status, 200);

    // Add explicit DENY on audit:integrity:scan for Auditor and prove 403
    const nowSec = Math.floor(Date.now() / 1000);
    const auditorCu = sqlite
      .prepare(`SELECT id FROM company_users WHERE company_id = ? AND user_id = 'usr-dg-auditor' LIMIT 1`)
      .get(PREVIEW_COMPANY_ID) as { id: string };
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO user_permission_overrides (id, company_user_id, permission_code, effect, reason, created_at)
         VALUES ('ovr-deny-audit-scan', ?, 'audit:integrity:scan', 'DENY', 'Test explicit deny on integrity scan', ?)`
      )
      .run(auditorCu.id, nowSec);

    const deniedAuditorScanRes = await request(app)
      .post('/api/audit/integrity/scan')
      .set('Authorization', `Bearer ${auditorToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);
    assert.equal(deniedAuditorScanRes.status, 403, 'Explicit DENY on audit:integrity:scan must block Auditor');

    sqlite.prepare(`DELETE FROM user_permission_overrides WHERE id = 'ovr-deny-audit-scan'`).run();
  });
});
