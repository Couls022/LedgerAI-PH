import { CompanyManager } from '../src/server/services/companyManager';
import { dbContext } from '../src/server/db/context';
import { db } from '../src/server/db';
import * as schema from '../src/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import fs from 'fs';

interface BenchmarkTierResult {
  tierRecords: number;
  ingestionTimeMs: number;
  throughputRecordsSec: number;
  p50QueryLatencyMs: number;
  p95QueryLatencyMs: number;
  p99QueryLatencyMs: number;
  dbSizeBytes: number;
  memoryRssBytes: number;
  glDebitsTotalCentavos: number;
  glCreditsTotalCentavos: number;
  glBalanced: boolean;
}

async function runVolumeBenchmark() {
  console.log('================================================================================');
  console.log('  SECTION 7: VOLUME TESTING GAP ANALYSIS & PERFORMANCE BENCHMARK');
  console.log('  Isolated Target Company: LGR-BENCH-VOLUME');
  console.log('  Testing Tiers: 1,000 | 10,000 | 50,000 | 100,000 records');
  console.log('================================================================================\n');

  await CompanyManager.init();
  const testCompanyId = 'LGR-BENCH-VOLUME';

  try {
    await CompanyManager.deleteCompany(testCompanyId);
  } catch (e) {}

  await CompanyManager.createCompanyProfile(
    testCompanyId,
    'LedgerAI Enterprise Volume Benchmark Corp'
  );

  const compDb = await CompanyManager.getCompanyDb(testCompanyId);
  if (!compDb) throw new Error('Database creation failed');
  const sqlite = await CompanyManager.getCompanySqlite(testCompanyId);

  const tiers = [1000, 10000, 50000, 100000];
  const results: BenchmarkTierResult[] = [];

  // Seed required master accounts & customer/vendor
  let cashAccountId = '';
  let revAccountId = '';
  let userId = '';

  await dbContext.run(compDb, async () => {
    let accs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, testCompanyId));
    if (accs.length < 2) {
      cashAccountId = crypto.randomUUID();
      revAccountId = crypto.randomUUID();
      await db.insert(schema.accounts).values([
        { id: cashAccountId, companyId: testCompanyId, accountCode: '1010-BNCH', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: revAccountId, companyId: testCompanyId, accountCode: '4010-BNCH', accountName: 'Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' }
      ]);
    } else {
      cashAccountId = accs[0].id;
      revAccountId = accs[1].id;
    }

    let users = await db.select().from(schema.users);
    if (!users.length) {
      userId = crypto.randomUUID();
      await db.insert(schema.users).values({
        id: userId,
        email: 'bench.admin@ledgerai.ph',
        passwordHash: 'hash',
        displayName: 'Benchmark Driver',
        status: 'ACTIVE'
      });
    } else {
      userId = users[0].id;
    }
  });

  // Prepare SQLite insert statements directly for high-throughput batching
  const insertJeStmt = sqlite.prepare(`
    INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, status, created_by, posted_by, posted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)
  `);

  const insertLineStmt = sqlite.prepare(`
    INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, line_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAuditStmt = sqlite.prepare(`
    INSERT INTO audit_logs (id, company_id, user_id, action, entity_type, entity_id, timestamp, result, severity, source)
    VALUES (?, ?, ?, 'JOURNAL_ENTRY_POSTED', 'journal_entries', ?, ?, 'SUCCESS', 'INFO', 'BENCHMARK')
  `);

  let cumulativeCount = 0;

  for (const targetTier of tiers) {
    const recordsToInsert = targetTier - cumulativeCount;
    console.log(`\n>>> Benchmarking Tier: ${targetTier.toLocaleString()} records (+${recordsToInsert.toLocaleString()} incremental records)...`);

    const startIngest = performance.now();
    const nowTs = Date.now();
    const dateStr = '2026-11-01';

    // Batch insert using SQLite transaction for production throughput
    const insertBatch = sqlite.transaction((count: number, startIdx: number) => {
      for (let i = 0; i < count; i++) {
        const idx = startIdx + i + 1;
        const jeId = `je-bench-${idx}`;
        const jNum = `JE-BNCH-${String(idx).padStart(7, '0')}`;
        const amountCentavos = 100000 + (idx % 1000) * 100; // ₱1,000.00 to ₱2,000.00

        // 1. Header
        insertJeStmt.run(jeId, testCompanyId, jNum, dateStr, `Benchmark automated journal #${idx}`, userId, userId, nowTs, nowTs, nowTs);

        // 2. Lines (Debits = Credits)
        insertLineStmt.run(`line-${jeId}-1`, jeId, cashAccountId, amountCentavos, 0, 1);
        insertLineStmt.run(`line-${jeId}-2`, jeId, revAccountId, 0, amountCentavos, 2);

        // 3. Audit log
        insertAuditStmt.run(`audit-${jeId}`, testCompanyId, userId, jeId, nowTs);
      }
    });

    insertBatch(recordsToInsert, cumulativeCount);
    cumulativeCount = targetTier;

    const ingestDurationMs = performance.now() - startIngest;
    const throughput = Math.round((recordsToInsert / (ingestDurationMs / 1000)));
    console.log(`    Ingestion completed in ${ingestDurationMs.toFixed(2)}ms (${throughput.toLocaleString()} rec/sec)`);

    // Latency benchmarks: 100 random queries
    const queryLatencies: number[] = [];
    const queryStmt = sqlite.prepare(`
      SELECT jl.account_id, SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit
      FROM journal_lines jl
      JOIN journal_entries je ON jl.journal_entry_id = je.id
      WHERE je.company_id = ? AND je.status = 'POSTED'
      GROUP BY jl.account_id
    `);

    for (let q = 0; q < 50; q++) {
      const qStart = performance.now();
      queryStmt.all(testCompanyId);
      queryLatencies.push(performance.now() - qStart);
    }

    queryLatencies.sort((a, b) => a - b);
    const p50 = queryLatencies[Math.floor(queryLatencies.length * 0.50)];
    const p95 = queryLatencies[Math.floor(queryLatencies.length * 0.95)];
    const p99 = queryLatencies[Math.floor(queryLatencies.length * 0.99)];

    // Check DB size and RSS Memory
    await CompanyManager.checkpointAndSyncFinancialSnapshotNow(testCompanyId);
    const manifest = await CompanyManager.getCompanyManifest(testCompanyId);
    const dbFileSizeBytes = manifest?.dbSnapshotSizeBytes || (fs.existsSync(manifest?.dbPath || '') ? fs.statSync(manifest!.dbPath).size : 0);
    const memoryRssBytes = process.memoryUsage().rss;

    // Verify double-entry balance at scale
    const balanceStmt = sqlite.prepare(`
      SELECT SUM(debit) as debits, SUM(credit) as credits FROM journal_lines
    `).get() as { debits: number; credits: number };

    const isBalanced = (balanceStmt.debits === balanceStmt.credits) && (balanceStmt.debits > 0);

    results.push({
      tierRecords: targetTier,
      ingestionTimeMs: Math.round(ingestDurationMs),
      throughputRecordsSec: throughput,
      p50QueryLatencyMs: Number(p50.toFixed(2)),
      p95QueryLatencyMs: Number(p95.toFixed(2)),
      p99QueryLatencyMs: Number(p99.toFixed(2)),
      dbSizeBytes: dbFileSizeBytes,
      memoryRssBytes: memoryRssBytes,
      glDebitsTotalCentavos: balanceStmt.debits,
      glCreditsTotalCentavos: balanceStmt.credits,
      glBalanced: isBalanced
    });

    console.log(`    P50: ${p50.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms | P99: ${p99.toFixed(2)}ms`);
    console.log(`    DB Size: ${(dbFileSizeBytes / (1024 * 1024)).toFixed(2)} MB | RSS Memory: ${(memoryRssBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`    GL Balance: Total Debits = ₱${(balanceStmt.debits / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}, Credits = ₱${(balanceStmt.credits / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (Balanced: ${isBalanced})`);
  }

  // Cleanup benchmark company
  await CompanyManager.closeCompanyDb(testCompanyId);
  await CompanyManager.deleteCompany(testCompanyId);

  console.log('\n================================================================================');
  console.log('VOLUME GAP ANALYSIS BENCHMARK SUMMARY TABLE');
  console.log('================================================================================');
  console.table(results.map(r => ({
    'Tier (Records)': r.tierRecords.toLocaleString(),
    'Ingestion Time': `${r.ingestionTimeMs}ms`,
    'Throughput': `${r.throughputRecordsSec.toLocaleString()} rec/s`,
    'P50 Latency': `${r.p50QueryLatencyMs}ms`,
    'P95 Latency': `${r.p95QueryLatencyMs}ms`,
    'P99 Latency': `${r.p99QueryLatencyMs}ms`,
    'DB Footprint': `${(r.dbSizeBytes / (1024 * 1024)).toFixed(2)} MB`,
    'RSS RAM': `${(r.memoryRssBytes / (1024 * 1024)).toFixed(1)} MB`,
    'GL Double-Entry': r.glBalanced ? 'PASS (100% Balanced)' : 'FAIL'
  })));
}

runVolumeBenchmark().catch(console.error);
