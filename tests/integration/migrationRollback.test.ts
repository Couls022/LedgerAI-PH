import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MigrationManager, MigrationDefinition } from '../../src/server/services/migrationManager';
import { CompanyManager } from '../../src/server/services/companyManager';

describe('Phase D — Schema Migration Rollback & Multi-Company Isolation Suite (Section 6.2)', () => {
  let tempDir: string;
  let dbPathA: string;
  let dbPathB: string;
  let sqliteA: Database.Database;
  let sqliteB: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-mig-test-'));
    dbPathA = path.join(tempDir, 'companyA.sqlite');
    dbPathB = path.join(tempDir, 'companyB.sqlite');
    sqliteA = new Database(dbPathA);
    sqliteB = new Database(dbPathB);
    sqliteA.pragma('journal_mode = WAL');
    sqliteB.pragma('journal_mode = WAL');
    CompanyManager.ensureBaseSchema(sqliteA);
    CompanyManager.ensureBaseSchema(sqliteB);
  });

  afterEach(() => {
    try { sqliteA.close(); } catch {}
    try { sqliteB.close(); } catch {}
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. executes all 9 steps of Section 6.2: Version N -> start N+1 -> schema+data change -> inject failure -> confirm rollback -> confirm version N -> confirm original data intact -> confirm Company B unaffected -> confirm valid retry succeeds', () => {
    // Step 1: Bring both Company A and Company B databases to baseline version N (v1..v14)
    MigrationManager.applyAllMigrations(sqliteA, 'COMP-MIG-A');
    MigrationManager.applyAllMigrations(sqliteB, 'COMP-MIG-B');

    const versionN = MigrationManager.getCurrentVersion(sqliteA);
    expect(versionN).toBe(MigrationManager.LATEST_VERSION);
    expect(MigrationManager.getCurrentVersion(sqliteB)).toBe(versionN);

    // Seed original financial state at Version N in both databases
    sqliteA.exec(`
      CREATE TABLE IF NOT EXISTS ledger_state_n (
        id TEXT PRIMARY KEY,
        account_code TEXT NOT NULL,
        balance_centavos INTEGER NOT NULL
      );
      INSERT INTO ledger_state_n (id, account_code, balance_centavos) VALUES ('row-1', '1010', 250000000);
    `);
    sqliteB.exec(`
      CREATE TABLE IF NOT EXISTS ledger_state_n (
        id TEXT PRIMARY KEY,
        account_code TEXT NOT NULL,
        balance_centavos INTEGER NOT NULL
      );
      INSERT INTO ledger_state_n (id, account_code, balance_centavos) VALUES ('row-b1', '1010', 999000000);
    `);

    const nextVersion = versionN + 1;

    // Step 2, 3, 4: Start migration N+1 on Company A, perform both DDL (table/column) and DML (data update) changes, then inject failure before completion
    const failingMigrationNPlus1: MigrationDefinition = {
      version: nextVersion,
      name: '0015_failing_atomic_test',
      up: (db) => {
        db.exec(`CREATE TABLE IF NOT EXISTS v15_new_subledger (id TEXT PRIMARY KEY, note TEXT);`);
        db.exec(`INSERT INTO v15_new_subledger (id, note) VALUES ('sub-1', 'uncommitted');`);
        db.exec(`UPDATE ledger_state_n SET balance_centavos = 0 WHERE id = 'row-1';`);
        throw new Error('INJECTED_MIGRATION_FAILURE_STEP_4: Simulated mid-migration constraint failure');
      },
    };

    expect(() => {
      MigrationManager.applyAllMigrations(sqliteA, 'COMP-MIG-A', [failingMigrationNPlus1]);
    }).toThrow(/MIGRATION_FAILED_ROLLED_BACK.*INJECTED_MIGRATION_FAILURE_STEP_4/);

    // Step 5 & 6: Confirm transaction rollback and confirm schema version remains N
    expect(MigrationManager.getCurrentVersion(sqliteA)).toBe(versionN);
    const v15TableInA = sqliteA
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v15_new_subledger'")
      .get();
    expect(v15TableInA).toBeUndefined();

    // Step 7: Confirm original data in Company A is 100% intact (balance was NOT zeroed)
    const rowA = sqliteA.prepare("SELECT balance_centavos FROM ledger_state_n WHERE id = 'row-1'").get() as any;
    expect(rowA.balance_centavos).toBe(250000000);

    // Step 8: Confirm unrelated Company B database is completely unaffected
    expect(MigrationManager.getCurrentVersion(sqliteB)).toBe(versionN);
    const rowB = sqliteB.prepare("SELECT balance_centavos FROM ledger_state_n WHERE id = 'row-b1'").get() as any;
    expect(rowB.balance_centavos).toBe(999000000);

    // Step 9: Replace with corrected migration N+1 and confirm subsequent valid migration retry works
    const validMigrationNPlus1: MigrationDefinition = {
      version: nextVersion,
      name: '0015_corrected_atomic_test',
      up: (db) => {
        db.exec(`CREATE TABLE IF NOT EXISTS v15_new_subledger (id TEXT PRIMARY KEY, note TEXT);`);
        db.exec(`INSERT INTO v15_new_subledger (id, note) VALUES ('sub-1', 'committed_cleanly');`);
      },
    };

    const resRetry = MigrationManager.applyAllMigrations(sqliteA, 'COMP-MIG-A', [validMigrationNPlus1]);
    expect(resRetry.appliedVersions).toContain(nextVersion);
    expect(MigrationManager.getCurrentVersion(sqliteA)).toBe(nextVersion);

    const v15Row = sqliteA.prepare("SELECT note FROM v15_new_subledger WHERE id = 'sub-1'").get() as any;
    expect(v15Row.note).toBe('committed_cleanly');
  });
});
