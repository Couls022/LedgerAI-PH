import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';

describe('LEDGERAI PH — Phase 6: Encryption at Rest & Secure Workspace Tests', () => {
  const testDir = path.join(process.cwd(), 'test-encryption-sandbox');
  const sqlitePath = path.join(testDir, 'test.sqlite');
  const laiPath = path.join(testDir, 'database.lai');

  beforeEach(async () => {
    // 1. Clean previous sandbox if present
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}

    // 2. Recreate clean sandbox directory
    await fs.mkdir(testDir, { recursive: true });

    // 3. Create fresh source SQLite database
    const db = new Database(sqlitePath);
    db.exec(`CREATE TABLE test_table (id TEXT PRIMARY KEY, val TEXT);`);
    db.prepare(`INSERT INTO test_table (id, val) VALUES (?, ?)`).run('1', 'secret-financial-data');
    db.close();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('AC-01 / AC-02: Encrypts SQLite database into a clean .lai container that cannot be opened as plaintext', async () => {
    await DatabaseEncryptionService.encryptDatabaseFile(sqlitePath, laiPath);

    const isEncrypted = await DatabaseEncryptionService.isEncryptedLai(laiPath);
    expect(isEncrypted).toBe(true);
    expect(DatabaseEncryptionService.isEncryptedLaiSync(laiPath)).toBe(true);

    // Verify raw file content does not contain plaintext secret
    const rawContent = await fs.readFile(laiPath);
    expect(rawContent.toString('utf8')).not.toContain('secret-financial-data');
    expect(rawContent.subarray(0, 8).toString('ascii')).toBe('LAISENC1');

    // Attempting to open encrypted .lai directly as a SQLite database and query it should fail
    expect(() => {
      const db = new Database(laiPath);
      db.prepare('SELECT * FROM test_table').all();
      db.close();
    }).toThrow();
  });

  it('Encrypts replacing an existing .lai destination safely (Windows replacement behavior)', async () => {
    // Initial encryption
    await DatabaseEncryptionService.encryptDatabaseFile(sqlitePath, laiPath);
    expect(fsSync.existsSync(laiPath)).toBe(true);

    // Create updated source database
    const updatedSqlite = path.join(testDir, 'updated.sqlite');
    const db = new Database(updatedSqlite);
    db.exec(`CREATE TABLE test_table (id TEXT PRIMARY KEY, val TEXT);`);
    db.prepare(`INSERT INTO test_table (id, val) VALUES (?, ?)`).run('1', 'updated-financial-data');
    db.close();

    // Re-encrypt over existing laiPath
    await DatabaseEncryptionService.encryptDatabaseFile(updatedSqlite, laiPath);
    expect(fsSync.existsSync(laiPath)).toBe(true);

    // Decrypt and verify updated data
    const decryptedPath = path.join(testDir, 'decrypted-updated.sqlite');
    const success = await DatabaseEncryptionService.decryptDatabaseFile(laiPath, decryptedPath);
    expect(success).toBe(true);

    const checkDb = new Database(decryptedPath);
    const row = checkDb.prepare('SELECT * FROM test_table WHERE id = ?').get('1') as any;
    expect(row).toBeDefined();
    expect(row.val).toBe('updated-financial-data');
    checkDb.close();

    // Verify no temporary files remain
    expect(fsSync.existsSync(`${laiPath}.tmp`)).toBe(false);
    expect(fsSync.existsSync(`${decryptedPath}.tmp`)).toBe(false);
  });

  it('AC-03 / AC-04 / AC-06: Correct decryption recovers exact database integrity and contents (async and sync)', async () => {
    await DatabaseEncryptionService.encryptDatabaseFile(sqlitePath, laiPath);

    // Async decryption
    const decryptedSqlitePath = path.join(testDir, 'decrypted.sqlite');
    const success = await DatabaseEncryptionService.decryptDatabaseFile(laiPath, decryptedSqlitePath);
    expect(success).toBe(true);

    const db = new Database(decryptedSqlitePath);
    const row = db.prepare('SELECT * FROM test_table WHERE id = ?').get('1') as any;
    expect(row).toBeDefined();
    expect(row.val).toBe('secret-financial-data');

    const integrity = db.pragma('integrity_check') as any[];
    expect(integrity[0].integrity_check).toBe('ok');
    db.close();

    // Sync decryption
    const decryptedSyncPath = path.join(testDir, 'decrypted-sync.sqlite');
    const syncSuccess = DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, decryptedSyncPath);
    expect(syncSuccess).toBe(true);

    const syncDb = new Database(decryptedSyncPath);
    const syncRow = syncDb.prepare('SELECT * FROM test_table WHERE id = ?').get('1') as any;
    expect(syncRow.val).toBe('secret-financial-data');
    syncDb.close();
  });

  it('AC-05: Tampering with encrypted workspace is detected via GCM authentication tag verification', async () => {
    await DatabaseEncryptionService.encryptDatabaseFile(sqlitePath, laiPath);

    // Tamper with ciphertext bytes
    const buf = await fs.readFile(laiPath);
    buf[buf.length - 10] ^= 0xFF; // Flip bits in ciphertext
    await fs.writeFile(laiPath, buf);

    const decryptedSqlitePath = path.join(testDir, 'tampered.sqlite');
    await expect(
      DatabaseEncryptionService.decryptDatabaseFile(laiPath, decryptedSqlitePath)
    ).rejects.toThrow(/DECRYPTION_FAILED/);

    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, path.join(testDir, 'tampered-sync.sqlite'));
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('Cleans up .tmp temporary files after successful and failed operations', async () => {
    // 1. Success cleanup
    await DatabaseEncryptionService.encryptDatabaseFile(sqlitePath, laiPath);
    expect(fsSync.existsSync(`${laiPath}.tmp`)).toBe(false);

    const decryptedPath = path.join(testDir, 'decrypted.sqlite');
    await DatabaseEncryptionService.decryptDatabaseFile(laiPath, decryptedPath);
    expect(fsSync.existsSync(`${decryptedPath}.tmp`)).toBe(false);

    // 2. Failure cleanup (e.g., nonexistent source file)
    const badSource = path.join(testDir, 'nonexistent.sqlite');
    const badDest = path.join(testDir, 'failed.lai');
    await expect(DatabaseEncryptionService.encryptDatabaseFile(badSource, badDest)).rejects.toThrow();
    expect(fsSync.existsSync(`${badDest}.tmp`)).toBe(false);

    // 3. Failure cleanup on tampered decryption
    const tamperedLai = path.join(testDir, 'corrupt.lai');
    await fs.writeFile(tamperedLai, Buffer.from('LAISENC1' + 'X'.repeat(100)));
    const tamperedDest = path.join(testDir, 'failed-decrypt.sqlite');
    await expect(DatabaseEncryptionService.decryptDatabaseFile(tamperedLai, tamperedDest)).rejects.toThrow();
    expect(fsSync.existsSync(`${tamperedDest}.tmp`)).toBe(false);
  });

  it('Sync encryption and decryption replacing existing files safely', () => {
    DatabaseEncryptionService.encryptDatabaseFileSync(sqlitePath, laiPath);
    expect(fsSync.existsSync(laiPath)).toBe(true);

    // Overwrite with sync encryption
    DatabaseEncryptionService.encryptDatabaseFileSync(sqlitePath, laiPath);
    expect(fsSync.existsSync(laiPath)).toBe(true);

    // Overwrite with sync decryption
    const syncDest = path.join(testDir, 'sync-recovered.sqlite');
    fsSync.writeFileSync(syncDest, 'dummy-old-data');
    
    const success = DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, syncDest);
    expect(success).toBe(true);

    const db = new Database(syncDest);
    const row = db.prepare('SELECT * FROM test_table WHERE id = ?').get('1') as any;
    expect(row.val).toBe('secret-financial-data');
    db.close();

    expect(fsSync.existsSync(`${syncDest}.tmp`)).toBe(false);
  });
});

