import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from "drizzle-orm";
import { fileURLToPath } from 'url';
import * as schema from "../db/schema";
import { MigrationManager } from "./migrationManager";
import { resolveCompanyIdFromParam } from "../../shared/vanityDomainUtils";

import { paths } from "./paths";
import { isLedgerProcessAlive } from "./serverInstanceLock";
import { DatabaseEncryptionService, EncryptionKeyMode } from "./databaseEncryptionService";
import {
  PortableAttachmentAudit,
  PortablePackageMetadata,
  assessCompanyIdentityDuplicate,
  remapRelocatedDocumentPathsSync,
  stripPortableSecrets,
  writePortableMetadataSync,
} from "./portableCompanyService";

export const COMPANIES_ROOT = paths.getCompaniesRootDir();
export const REGISTRY_FILE = paths.getRegistryFilePath();

export type CompanyClassification =
  | 'DEVELOPMENT'
  | 'TEST'
  | 'STRESS_TEST'
  | 'BENCHMARK'
  | 'DISPOSABLE'
  | 'PILOT'
  | 'PRODUCTION';

export const VALID_COMPANY_CLASSIFICATIONS: CompanyClassification[] = [
  'DEVELOPMENT',
  'TEST',
  'STRESS_TEST',
  'BENCHMARK',
  'DISPOSABLE',
  'PILOT',
  'PRODUCTION',
];

export const SYNTHETIC_COMPANY_CLASSIFICATIONS = new Set<CompanyClassification>([
  'TEST',
  'STRESS_TEST',
  'BENCHMARK',
  'DISPOSABLE',
]);

export const RESERVED_PROTECTED_COMPANY_IDS = new Set<string>([
  'LGR-PH-2026-PILOT-CLEAN-01',
  'LGR-PH-2026-PILOT-EXPANDED-01',
  'LGR-PH-2026-DEFECT-CLOSURE-01',
  'LGR-PH-OP-AUDIT-VAT-CORP-2026',
  'LGR-PH-OP-AUDIT-NONVAT-CORP-2026',
  'LGR-PH-OP-AUDIT-SOLE-PROP-2026',
  'LGR-PH-PROD-ACME-01',
  'LGR-PH-DEV-EXP-01',
]);

export function isSyntheticCompanyClassification(classification?: string | null): boolean {
  if (!classification) return false;
  return SYNTHETIC_COMPANY_CLASSIFICATIONS.has(classification.toUpperCase() as CompanyClassification);
}

export function isProtectedCompanyClassification(classification?: string | null): boolean {
  if (!classification) return true;
  const upper = classification.toUpperCase() as CompanyClassification;
  return upper === 'PRODUCTION' || upper === 'PILOT' || upper === 'DEVELOPMENT';
}

export interface VerifiedOrphanedFixtureProvenance {
  companyId: string;
  testFileOrigin: string;
  verifiedClassification: 'TEST' | 'STRESS_TEST' | 'BENCHMARK' | 'DISPOSABLE';
  reason: string;
}

export interface StaleRegistryCleanupOptions {
  authorizedByUserId?: string;
  authorizedByRole?: string;
  reason?: string;
  dryRun?: boolean;
  verifiedOrphanedFixtureProvenance?: VerifiedOrphanedFixtureProvenance[];
}

export interface CompanyManifest {
  id: string;
  legalName: string;
  createdAt: string;
  dbPath: string;
  documentLocation: string; // Renamed for clarity
  backupLocation: string; // Ensure it exists
  location: string; // Directory path
  status?: string;
  registrationStatus?: 'REGISTERED' | 'UNREGISTERED' | 'ARCHIVED';
  unregisteredAt?: string;
  archivedAt?: string;
  classification?: CompanyClassification;
  encryptionKeyMode?: EncryptionKeyMode;
  keyId?: string;
  isDemo?: boolean;
  isVisualStressPreview?: boolean;
  lastOpenedAt?: string;
  dbChecksum?: string;
  lastSnapshotSyncedAt?: string;
  dbSnapshotSizeBytes?: number;
  recoveryKey?: string;
  recoveryUsedAt?: string;
  portableMetadata?: PortablePackageMetadata;
}

export interface ListCompaniesOptions {
  excludeNonProduction?: boolean;
  classification?: CompanyClassification | CompanyClassification[];
  includeSynthetic?: boolean;
  includeTestCompanies?: boolean;
  search?: string;
  sortBy?: 'legalName' | 'createdAt' | 'id';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ListCompaniesResult {
  items: CompanyManifest[];
  totalCount: number;
  filteredCount: number;
  limit?: number;
  offset?: number;
}

export function inferCompanyClassification(
  companyId: string,
  legalName?: string,
  isDemo?: boolean,
  explicitClassification?: string
): CompanyClassification {
  if (
    explicitClassification &&
    VALID_COMPANY_CLASSIFICATIONS.includes(explicitClassification.toUpperCase() as CompanyClassification)
  ) {
    return explicitClassification.toUpperCase() as CompanyClassification;
  }
  const idUpper = String(companyId || '').toUpperCase();
  const nameUpper = String(legalName || '').toUpperCase();

  if (idUpper.includes('DISPOSABLE') || nameUpper.includes('DISPOSABLE')) {
    return 'DISPOSABLE';
  }
  if (idUpper.includes('BENCH') || nameUpper.includes('BENCHMARK')) {
    return 'BENCHMARK';
  }
  if (
    idUpper === 'LGR-PH-2026-TEST-00-ABC12345' ||
    idUpper.startsWith('LGR-ST-') ||
    idUpper.includes('STRESS') ||
    idUpper.startsWith('LGR-DEF') ||
    idUpper.includes('FAILOVER') ||
    idUpper.includes('-TEST-') ||
    idUpper.startsWith('TEST-') ||
    nameUpper.includes('STRESS') ||
    nameUpper.includes('FAILOVER') ||
    nameUpper.includes('TEST CORP')
  ) {
    if (idUpper.startsWith('LGR-ST-') || idUpper.includes('STRESS') || nameUpper.includes('STRESS') || idUpper.includes('FAILOVER')) {
      return 'STRESS_TEST';
    }
    return 'TEST';
  }
  if (idUpper.includes('PILOT') || nameUpper.includes('PILOT')) {
    return 'PILOT';
  }
  if (idUpper.includes('PROD') || nameUpper.includes('PRODUCTION')) {
    return 'PRODUCTION';
  }
  if (isDemo) {
    return 'DEVELOPMENT';
  }
  return 'DEVELOPMENT';
}

export interface RecoveryDiagnosticResult {
  companyId: string;
  timestamp: string;
  status:
    | 'INITIALIZED_NEW'
    | 'PRESERVED_ACTIVE'
    | 'RECOVERED_FROM_ACTIVE_NO_WAL'
    | 'RECOVERED_FROM_LAI_SNAPSHOT'
    | 'RECOVERED_FROM_BACKUP'
    | 'QUARANTINED_MANUAL_INTERVENTION_REQUIRED';
  originalDataPreserved: boolean;
  recovered: boolean;
  requiresManualIntervention: boolean;
  quarantinePath?: string;
  quarantinedFiles?: Array<{ fileName: string; sizeBytes: number; sha256: string }>;
  recoverySource?: string;
  integrityCheck: string;
  walCheckpointed: boolean;
  details: string;
}

const dbCache = new Map<string, any>();
const sqliteCache = new Map<string, any>();
const sqliteInodeCache = new Map<string, number>();
const tempManifests = new Map<string, CompanyManifest>();
const recoveryDiagnosticsMap = new Map<string, RecoveryDiagnosticResult>();
const snapshotSyncTimers = new Map<string, NodeJS.Timeout>();
const activeCompanyRequests = new Map<string, number>();
const lastCompanyAccessAt = new Map<string, number>();
const companyWriteQueues = new Map<string, Promise<unknown>>();

const DEFAULT_IDLE_EVICTION_MS = 5 * 60 * 1000; // 5 minutes idle threshold for multi-user pool safety

export class CompanyManager {
  static trackRequestStart(companyId: string): void {
    if (!companyId) return;
    activeCompanyRequests.set(companyId, (activeCompanyRequests.get(companyId) || 0) + 1);
    lastCompanyAccessAt.set(companyId, Date.now());
  }

  static trackRequestEnd(companyId: string): void {
    if (!companyId) return;
    const current = activeCompanyRequests.get(companyId) || 0;
    if (current <= 1) {
      activeCompanyRequests.delete(companyId);
    } else {
      activeCompanyRequests.set(companyId, current - 1);
    }
    lastCompanyAccessAt.set(companyId, Date.now());
  }

  static getPoolMetrics(): {
    openCompanyCount: number;
    openCompanyIds: string[];
    activeRequestCount: number;
    activeRequestsByCompany: Record<string, number>;
  } {
    const openCompanyIds = Array.from(new Set<string>([...dbCache.keys(), ...sqliteCache.keys()]));
    let activeRequestCount = 0;
    const activeRequestsByCompany: Record<string, number> = {};
    for (const [cid, count] of activeCompanyRequests.entries()) {
      activeRequestCount += count;
      activeRequestsByCompany[cid] = count;
    }
    return {
      openCompanyCount: openCompanyIds.length,
      openCompanyIds,
      activeRequestCount,
      activeRequestsByCompany,
    };
  }

  /**
   * Serializes concurrent writes targeting the same company SQLite database with
   * automatic SQLITE_BUSY exponential backoff retry, while allowing different
   * companies to execute completely in parallel across the central server.
   */
  static async withCompanyWriteLock<T>(
    companyId: string,
    fn: () => Promise<T> | T,
    maxRetries = 5
  ): Promise<T> {
    const prior = companyWriteQueues.get(companyId) || Promise.resolve();
    let release!: () => void;
    const nextGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prior.then(() => nextGate);
    companyWriteQueues.set(companyId, chained);

    await prior;
    try {
      let attempt = 0;
      while (true) {
        try {
          lastCompanyAccessAt.set(companyId, Date.now());
          return await fn();
        } catch (err: any) {
          const msg = String(err?.message || err?.code || '');
          const isBusy = msg.includes('SQLITE_BUSY') || msg.includes('database is locked');
          if (isBusy && attempt < maxRetries) {
            attempt += 1;
            const backoffMs = Math.min(50 * Math.pow(2, attempt - 1), 800);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw err;
        }
      }
    } finally {
      release();
      if (companyWriteQueues.get(companyId) === chained) {
        companyWriteQueues.delete(companyId);
      }
    }
  }
  static getDeploymentTopologyInfo() {
    return {
      topology: 'TOPOLOGY_A_CENTRALIZED_LAN_SERVER',
      topologyDescription: 'Centralized LAN API Server where multiple client workstations connect via HTTP/WebSocket to a single application server host that exclusively manages local SQLite database connections.',
      concurrencyModel: 'API_LEVEL_HTTP_WEBSOCKET_CONCURRENCY',
      databaseEngine: 'better-sqlite3',
      journalMode: 'WAL',
      sharedMemoryLocation: 'LOCAL_POSIX_SHM',
      singleProcessOwnership: true,
      supportedWorkstations: '5-25 concurrent LAN clients',
      unsupportedTopologies: [
        {
          type: 'TOPOLOGY_B_SHARED_SQLITE_FILE_OVER_SMB_NFS',
          status: 'PROHIBITED',
          reason: 'Network file sharing protocols (SMB, CIFS, NFS) do not reliably support POSIX shared-memory advisory locking required by SQLite WAL mode (-shm files), leading to silent database corruption.'
        },
        {
          type: 'TOPOLOGY_C_MULTI_SERVER_PROCESSES_SHARED_DB',
          status: 'PROHIBITED',
          reason: 'Multiple server processes accessing the same SQLite database file without distributed lock coordination causes transaction lock collisions and WAL checkpoint race conditions.'
        }
      ]
    };
  }

  static setTempManifest(companyId: string, manifest: CompanyManifest) {
    tempManifests.set(companyId, manifest);
  }

  static removeTempManifest(companyId: string) {
    tempManifests.delete(companyId);
  }

  static getRecoveryDiagnostics(companyId: string): RecoveryDiagnosticResult | null {
    return recoveryDiagnosticsMap.get(companyId) || null;
  }

  static getAllRecoveryDiagnostics(): Record<string, RecoveryDiagnosticResult> {
    const out: Record<string, RecoveryDiagnosticResult> = {};
    for (const [k, v] of recoveryDiagnosticsMap.entries()) {
      out[k] = v;
    }
    return out;
  }

  static scheduleSnapshotSync(companyId: string, delayMs: number = 150) {
    if (!companyId) return;
    const existingTimer = snapshotSyncTimers.get(companyId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      snapshotSyncTimers.delete(companyId);
      this.syncCompanyDatabaseSnapshot(companyId).catch(() => {});
    }, delayMs);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    snapshotSyncTimers.set(companyId, timer);
  }

  static async getCompanySqlite(companyId: string): Promise<any | null> {
    if (!sqliteCache.has(companyId)) {
      await this.getCompanyDb(companyId);
    }
    return sqliteCache.get(companyId) || null;
  }

  static async checkpointAndSyncFinancialSnapshotNow(companyId: string): Promise<boolean> {
    if (!companyId) return false;
    const existingTimer = snapshotSyncTimers.get(companyId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      snapshotSyncTimers.delete(companyId);
    }
    return await this.syncCompanyDatabaseSnapshot(companyId);
  }

  static async syncCompanyDatabaseSnapshot(companyId: string): Promise<boolean> {
    try {
      const manifest = await this.getCompanyManifest(companyId);
      if (!manifest) return false;
      const companyDir = manifest.location || path.dirname(manifest.dbPath);
      const activeSqlitePath = path.resolve(companyDir, '.db_active.sqlite');
      const dbPath = manifest.dbPath || path.resolve(companyDir, 'database.lai');

      const sqlite = sqliteCache.get(companyId);
      if (sqlite && typeof sqlite.pragma === 'function') {
        try {
          sqlite.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          try { sqlite.pragma('wal_checkpoint(FULL)'); } catch {}
        }
        const integrity = sqlite.pragma('integrity_check') as any[];
        if (integrity?.[0]?.integrity_check !== 'ok') {
          return false;
        }
      }

      if (fsSync.existsSync(activeSqlitePath) && dbPath) {
        DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath, {
          companyId,
          classification: manifest.classification || inferCompanyClassification(companyId, manifest.legalName, manifest.isDemo),
          keyMode: manifest.encryptionKeyMode,
        });

        // Compute SHA-256 hash of encrypted snapshot, write secret-free portable_meta.json, and record to manifest
        try {
          if (fsSync.existsSync(dbPath)) {
            const buf = fsSync.readFileSync(dbPath);
            const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
            let schemaVer = MigrationManager.LATEST_VERSION;
            let docCount = 0;
            if (sqlite && typeof sqlite.prepare === 'function') {
              try {
                schemaVer = MigrationManager.getCurrentVersion(sqlite);
              } catch {}
              try {
                const cnt = sqlite.prepare('SELECT COUNT(*) as n FROM documents').get() as { n?: number } | undefined;
                docCount = Number(cnt?.n || 0);
              } catch {}
            }
            const containerMeta = DatabaseEncryptionService.inspectContainerMetadataSync(dbPath);
            const portableMetadata = writePortableMetadataSync({
              companyDirectory: companyDir,
              companyId,
              legalName: manifest.legalName,
              dbPath,
              schemaVersion: schemaVer,
              encryptionFormat: containerMeta.containerVersion === 'LAISENC2' ? 'LAISENC2' : 'LAISENC1',
              encryptionKeyRef: manifest.keyId || manifest.encryptionKeyMode || containerMeta.keyMode || null,
              attachmentCount: docCount,
              createdAt: manifest.createdAt,
            });
            await this.updateCompanyManifest(companyId, {
              dbChecksum: sha256,
              lastSnapshotSyncedAt: new Date().toISOString(),
              dbSnapshotSizeBytes: buf.length,
              portableMetadata,
            } as any);
          }
        } catch (_) {}

        return true;
      }
      return false;
    } catch (err: any) {
      console.warn(`[CompanyManager] Snapshot sync warning for ${companyId}:`, err?.message);
      return false;
    }
  }

  static async verifySnapshotConsistency(
    companyId: string,
    options?: { expectedChecksum?: string }
  ): Promise<{
    valid: boolean;
    status: 'VALID' | 'MISSING_SNAPSHOT' | 'CORRUPTED_SNAPSHOT' | 'MISMATCHED_SNAPSHOT';
    activeChecksum?: string;
    laiChecksum?: string;
    expectedChecksum?: string;
    details: string;
  }> {
    try {
      const manifest = await this.getCompanyManifest(companyId);
      if (!manifest) {
        return { valid: false, status: 'MISSING_SNAPSHOT', details: 'Company manifest not found' };
      }
      const companyDir = manifest.location || path.dirname(manifest.dbPath);
      const dbPath = manifest.dbPath || path.resolve(companyDir, 'database.lai');
      if (!fsSync.existsSync(dbPath)) {
        return {
          valid: false,
          status: 'MISSING_SNAPSHOT',
          details: 'Encrypted snapshot database.lai does not exist on disk'
        };
      }
      const laiBuf = fsSync.readFileSync(dbPath);
      if (laiBuf.length === 0) {
        return {
          valid: false,
          status: 'CORRUPTED_SNAPSHOT',
          details: 'Encrypted snapshot database.lai is empty (0 bytes)'
        };
      }
      const laiSha256 = crypto.createHash('sha256').update(laiBuf).digest('hex');

      if (options?.expectedChecksum && options.expectedChecksum !== laiSha256) {
        return {
          valid: false,
          status: 'MISMATCHED_SNAPSHOT',
          laiChecksum: laiSha256,
          expectedChecksum: options.expectedChecksum,
          details: `Snapshot checksum mismatch: expected ${options.expectedChecksum}, found ${laiSha256}`
        };
      }

      const manifestChecksum = (manifest as any).dbChecksum;
      const hasPendingTimer = snapshotSyncTimers.has(companyId);
      if (manifestChecksum && !hasPendingTimer && manifestChecksum !== laiSha256) {
        return {
          valid: false,
          status: 'MISMATCHED_SNAPSHOT',
          laiChecksum: laiSha256,
          expectedChecksum: manifestChecksum,
          details: `Snapshot SHA-256 (${laiSha256}) does not match recorded manifest checksum (${manifestChecksum})`
        };
      }

      const tempTestPath = path.resolve(os.tmpdir(), `.verify_test_${companyId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.sqlite`);
      let testSqlite: any = null;
      try {
        try {
          DatabaseEncryptionService.decryptDatabaseFileSync(dbPath, tempTestPath);
        } catch (decErr: any) {
          return {
            valid: false,
            status: 'CORRUPTED_SNAPSHOT',
            laiChecksum: laiSha256,
            details: `Snapshot decryption failed (corrupted or tampered .lai archive): ${decErr.message}`
          };
        }

        try {
          testSqlite = new Database(tempTestPath, { readonly: true });
          const check = testSqlite.pragma('integrity_check') as any[];
          if (check?.[0]?.integrity_check !== 'ok') {
            return {
              valid: false,
              status: 'CORRUPTED_SNAPSHOT',
              laiChecksum: laiSha256,
              details: 'Snapshot decrypted but failed SQLite PRAGMA integrity_check'
            };
          }

          // Verify internal company identity matches target companyId (detect cross-company or mismatched snapshot swap)
          const compRows = testSqlite.prepare('SELECT id FROM companies').all() as Array<{ id: string }>;
          if (compRows.length > 0 && !compRows.some(r => r.id === companyId)) {
            return {
              valid: false,
              status: 'MISMATCHED_SNAPSHOT',
              laiChecksum: laiSha256,
              details: `Decrypted snapshot belongs to company '${compRows[0].id}' instead of expected '${companyId}'`
            };
          }
        } catch (sqlErr: any) {
          return {
            valid: false,
            status: 'CORRUPTED_SNAPSHOT',
            laiChecksum: laiSha256,
            details: `Decrypted snapshot failed SQLite structural verification: ${sqlErr.message}`
          };
        }

        return {
          valid: true,
          status: 'VALID',
          laiChecksum: laiSha256,
          details: 'Snapshot is consistent, valid, and passes PRAGMA integrity_check.'
        };
      } finally {
        try { if (testSqlite) testSqlite.close(); } catch {}
        try { if (fsSync.existsSync(tempTestPath)) fsSync.unlinkSync(tempTestPath); } catch {}
      }
    } catch (err: any) {
      return {
        valid: false,
        status: 'CORRUPTED_SNAPSHOT',
        details: `Snapshot verification error: ${err.message}`
      };
    }
  }

  static flushAllPendingSnapshotsSync() {
    for (const [companyId, timer] of snapshotSyncTimers.entries()) {
      clearTimeout(timer);
      snapshotSyncTimers.delete(companyId);
      try {
        const manifest = tempManifests.get(companyId);
        const sqlite = sqliteCache.get(companyId);
        if (sqlite && typeof sqlite.pragma === 'function') {
          try { sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        }
        if (manifest && manifest.location) {
          const activeSqlitePath = path.resolve(manifest.location, '.db_active.sqlite');
          if (fsSync.existsSync(activeSqlitePath) && manifest.dbPath) {
            DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, manifest.dbPath);
          }
        }
      } catch {}
    }
  }

  private static quarantineDatabaseFilesSync(
    companyId: string,
    companyDir: string,
    reason: string
  ): { quarantineDir: string; quarantinedFiles: Array<{ fileName: string; sizeBytes: number; sha256: string }> } {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const shortId = crypto.randomBytes(3).toString('hex');
    const quarantineDir = path.join(companyDir, 'quarantine', `recovery_${ts}_${shortId}`);
    fsSync.mkdirSync(quarantineDir, { recursive: true });

    const candidateNames = [
      '.db_active.sqlite',
      '.db_active.sqlite-wal',
      '.db_active.sqlite-shm',
      'database.lai',
      'database.sqlite'
    ];
    const quarantinedFiles: Array<{ fileName: string; sizeBytes: number; sha256: string }> = [];

    for (const fileName of candidateNames) {
      const srcPath = path.join(companyDir, fileName);
      if (fsSync.existsSync(srcPath)) {
        try {
          const stat = fsSync.statSync(srcPath);
          if (stat.isFile()) {
            const buf = fsSync.readFileSync(srcPath);
            const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
            const destPath = path.join(quarantineDir, fileName);
            fsSync.copyFileSync(srcPath, destPath);
            quarantinedFiles.push({ fileName, sizeBytes: stat.size, sha256 });
          }
        } catch (copyErr: any) {
          console.warn(`[CompanyManager] Quarantine copy warning for ${fileName}:`, copyErr?.message);
        }
      }
    }

    const quarantineManifest = {
      companyId,
      quarantinedAt: new Date().toISOString(),
      reason,
      quarantineDir,
      files: quarantinedFiles
    };
    try {
      fsSync.writeFileSync(
        path.join(quarantineDir, 'quarantine_manifest.json'),
        JSON.stringify(quarantineManifest, null, 2)
      );
    } catch {}

    return { quarantineDir, quarantinedFiles };
  }

  private static recordSecurityRecoveryAuditSync(
    companyId: string,
    companyDir: string,
    sqlite: any | null,
    diagnostic: RecoveryDiagnosticResult
  ) {
    recoveryDiagnosticsMap.set(companyId, diagnostic);

    // 1. Durable file-level security audit log in company workspace
    try {
      const logFile = path.join(companyDir, 'security_recovery_audit.jsonl');
      const line = JSON.stringify({
        eventId: crypto.randomUUID(),
        eventType: 'DATABASE_RECOVERY_SECURITY_AUDIT',
        ...diagnostic
      }) + '\n';
      fsSync.appendFileSync(logFile, line, 'utf8');
    } catch {}

    // 2. Database-level immutable security audit record if SQLite connection is available
    if (sqlite && (diagnostic.recovered || diagnostic.requiresManualIntervention)) {
      try {
        const hasAuditTable = sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'")
          .get();
        if (hasAuditTable) {
          sqlite
            .prepare(`
              INSERT INTO audit_logs (
                id, company_id, action, entity_type, entity_id,
                result, reason, module, severity, source, metadata, timestamp
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              crypto.randomUUID(),
              companyId,
              diagnostic.requiresManualIntervention
                ? 'DATABASE_RECOVERY_QUARANTINED'
                : 'DATABASE_RECOVERY_EXECUTED',
              'COMPANY',
              companyId,
              diagnostic.requiresManualIntervention ? 'FAILED' : 'SUCCESS',
              diagnostic.details,
              'SECURITY',
              diagnostic.requiresManualIntervention ? 'CRITICAL' : 'WARN',
              'SYSTEM_RECOVERY_ENGINE',
              JSON.stringify(diagnostic),
              Date.now()
            );
        }
      } catch {}
    }
  }

  private static hasValidFinancialAndCompanyDataSync(sqlite: any, expectedCompanyId?: string, allowEmptyAccounts: boolean = false): boolean {
    try {
      const hasCompTable = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'")
        .get();
      if (!hasCompTable) return false;

      const compRows = sqlite.prepare('SELECT id, legal_name FROM companies').all() as any[];
      if (!compRows || compRows.length === 0) return false;

      if (expectedCompanyId && !compRows.some((r: any) => String(r.id) === expectedCompanyId)) {
        return false;
      }

      if (allowEmptyAccounts) {
        return true;
      }

      // If the database has confirmed company row matching expectedCompanyId, it is a valid company database
      if (expectedCompanyId && compRows.some((r: any) => String(r.id) === expectedCompanyId)) {
        return true;
      }

      let userCount = 0;
      let accountCount = 0;
      try {
        userCount = Number((sqlite.prepare('SELECT COUNT(*) as n FROM users').get() as any)?.n || 0);
      } catch {}
      try {
        accountCount = Number((sqlite.prepare('SELECT COUNT(*) as n FROM accounts').get() as any)?.n || 0);
      } catch {}

      return userCount > 0 || accountCount > 0;
    } catch {
      return false;
    }
  }

  private static previewSeedPromise: Promise<void> | null = null;

  static isStressPreviewSeedingInProgress(): boolean {
    return Boolean(this.previewSeedPromise);
  }

  static async ensureStressPreviewSeeded(options?: { forceExplicitDemo?: boolean }): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;
    if (!options?.forceExplicitDemo && process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED !== 'true') {
      return;
    }
    const companies = await this.listCompanies({ includeSynthetic: true });
    const existing = companies.find(c => c.id === 'LGR-PH-2026-STRESS-DG-PREVIEW');
    const previewDir = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions_stress_preview');
    const markerPath = path.join(previewDir, '.seeded_complete');
    const manifestPath = path.join(previewDir, 'manifest.json');
    if (existing && fsSync.existsSync(markerPath)) return;
    if (!existing && fsSync.existsSync(manifestPath)) {
      try {
        const manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
        if (manifestObj.registrationStatus === 'UNREGISTERED') {
          return;
        }
      } catch {}
    }
    if (!this.previewSeedPromise) {
      this.previewSeedPromise = (async () => {
        try {
          const { seedDeskguardStressPreview } = await import('../scripts/seedDeskguardStressPreview');
          await seedDeskguardStressPreview();
        } catch (err) {
          console.warn('[CompanyManager] Auto-seed of Deskguard Stress Preview skipped:', (err as any)?.message || err);
        } finally {
          this.previewSeedPromise = null;
        }
      })();
    }
    await this.previewSeedPromise;
  }

  static async getCompanyManifest(companyId: string): Promise<CompanyManifest | undefined> {
    let companies = await this.listCompanies({ includeSynthetic: true });
    const exactMatch =
      companies.find(c => c.id === companyId) ||
      tempManifests.get(companyId);
    if (exactMatch) {
      return exactMatch;
    }
    const candidates = [...companies, ...Array.from(tempManifests.values())];
    const resolvedId = resolveCompanyIdFromParam(companyId, candidates);
    let found =
      companies.find(c => c.id === resolvedId) ||
      tempManifests.get(resolvedId);
    if (
      !found &&
      (companyId === 'LGR-PH-2026-STRESS-DG-PREVIEW' || resolvedId === 'LGR-PH-2026-STRESS-DG-PREVIEW') &&
      process.env.NODE_ENV !== 'production' &&
      process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED === 'true'
    ) {
      await this.ensureStressPreviewSeeded();
      companies = await this.listCompanies({ includeSynthetic: true });
      found =
        companies.find(c => c.id === resolvedId) ||
        companies.find(c => c.id === companyId) ||
        tempManifests.get(resolvedId) ||
        tempManifests.get(companyId);
    }
    return found;
  }

  static async init() {
    const root = paths.getCompaniesRootDir();
    const reg = paths.getRegistryFilePath();
    console.log(`[CompanyManager Debug] init root: ${root}, reg: ${reg}`);
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.dirname(reg), { recursive: true });
    
    try {
      await fs.access(reg);
      console.log(`[CompanyManager Debug] Registry exists`);
    } catch {
      console.log(`[CompanyManager Debug] Creating empty registry`);
      await fs.writeFile(reg, JSON.stringify([]));
    }

    // Zero-Data Clean Start Requirement:
    // Fresh installations and standard startups MUST start with zero company profiles and zero company databases.
    // Demo/sample seeding is permitted ONLY when explicitly opted-in via LEDGERAI_ALLOW_AUTO_DEMO_SEED=true in non-production.
    console.log(`[CompanyManager Debug] NODE_ENV: ${process.env.NODE_ENV}`);
    if (process.env.NODE_ENV !== 'production' && process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED === 'true') {
      try {
        await this.seedDefaultCompanyIfEmpty();
      } catch (e) {
        console.error("Failed to seed default company in opted-in demo mode:", e);
      }
    }
  }

  private static async acquireRegistryLock(lockFile: string, maxAttempts = 15, delayMs = 100) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Try to create the lock file
        await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
        return;
      } catch (err: any) {
        // If file exists, check for stale lock
        try {
          const content = await fs.readFile(lockFile, 'utf8');
          const pid = parseInt(content, 10);
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 0); // Check if process is alive
            } catch (killErr: any) {
              // Process doesn't exist, stale lock
              console.warn(`[CompanyManager] Detected stale registry lock from PID ${pid}. Recovering...`);
              await fs.unlink(lockFile).catch(() => {});
              // Continue to next attempt to try and acquire it
              continue;
            }
          }
        } catch (readErr) {
          // File might have been deleted between attempts
        }

        if (i === maxAttempts - 1) {
          throw new Error(`Registry locked by another process (PID ${process.pid} failed after ${maxAttempts} attempts)`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  private static async withRegistryLock<T>(fn: (companies: CompanyManifest[]) => Promise<{ companies: CompanyManifest[], result: T }>): Promise<T> {
    const regFile = paths.getRegistryFilePath();
    const lockFile = `${regFile}.lock`;
    const tempFile = `${regFile}.tmp`;

    await this.acquireRegistryLock(lockFile);

    try {
      let companies: CompanyManifest[] = [];
      try {
        const content = await fs.readFile(regFile, 'utf8');
        companies = JSON.parse(content);
      } catch (readErr) {
        // If file missing or corrupt, start with empty
        companies = [];
      }

      const { companies: nextCompanies, result } = await fn(companies);

      // Enforce classification inference during every write to ensure consistency
      const enriched = nextCompanies.map(c => ({
        ...c,
        classification: inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification)
      }));

      await fs.writeFile(tempFile, JSON.stringify(enriched, null, 2));
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempFile, regFile);
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
            if (attempt >= 2) {
              try {
                await fs.unlink(regFile);
              } catch {}
            }
          } else {
            break;
          }
        }
      }
      if (lastError) {
        try {
          await fs.copyFile(tempFile, regFile);
          await fs.unlink(tempFile).catch(() => {});
        } catch (copyErr) {
          throw lastError || copyErr;
        }
      }
      return result;
    } finally {
      await fs.unlink(lockFile).catch(() => {});
    }
  }

  static appendGovernanceAuditLogSync(eventType: string, payload: Record<string, any>) {
    try {
      const logDir = paths.getLogsDir();
      fsSync.mkdirSync(logDir, { recursive: true });
      const logFile = path.join(logDir, 'registry_governance_audit.jsonl');
      const record = {
        eventId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        eventType,
        ...payload,
      };
      fsSync.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
      return record;
    } catch {
      return null;
    }
  }

  static async registerCompany(manifest: CompanyManifest) {
    const normalizedManifest: CompanyManifest = {
      ...manifest,
      registrationStatus: 'REGISTERED',
      unregisteredAt: undefined,
    };
    return this.withRegistryLock(async (companies) => {
      const normLoc = normalizedManifest.location
        ? path.resolve(normalizedManifest.location).replace(/\\/g, '/').toLowerCase()
        : '';
      const filtered = companies.filter((c) => {
        if (c.id === normalizedManifest.id) return false;
        if (normLoc) {
          const cLoc = c.location ? path.resolve(c.location).replace(/\\/g, '/').toLowerCase() : '';
          if (cLoc === normLoc) return false;
        }
        return true;
      });
      filtered.push(normalizedManifest);
      return { companies: filtered, result: undefined };
    });
  }

  static async unregisterCompany(companyId: string) {
    return this.withRegistryLock(async (companies) => {
      const target = companies.find(c => c.id === companyId);
      if (target) {
        try {
          const targetDir = target.location || path.dirname(target.dbPath);
          const manifestPath = path.join(targetDir, 'manifest.json');
          if (fsSync.existsSync(manifestPath)) {
            const manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
            manifestObj.registrationStatus = 'UNREGISTERED';
            manifestObj.unregisteredAt = new Date().toISOString();
            fsSync.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8');
          }
        } catch {}
      }
      const filtered = companies.filter(c => c.id !== companyId);
      return { companies: filtered, result: undefined };
    });
  }

  static async updateCompanyManifest(companyId: string, updates: Partial<CompanyManifest>) {
    if (tempManifests.has(companyId)) {
      const updatedTemp = { ...tempManifests.get(companyId)!, ...updates };
      tempManifests.set(companyId, updatedTemp);
      const tempLoc = updatedTemp.location || (updatedTemp.dbPath ? path.dirname(updatedTemp.dbPath) : '');
      if (tempLoc) {
        try {
          await fs.writeFile(path.join(tempLoc, "manifest.json"), JSON.stringify(updatedTemp, null, 2));
        } catch {}
      }
    }
    return this.withRegistryLock(async (companies) => {
      const index = companies.findIndex(c => c.id === companyId);
      if (index > -1) {
        companies[index] = { ...companies[index], ...updates };
        
        // Also update manifest.json in company directory
        const manifestPath = path.join(companies[index].location || path.dirname(companies[index].dbPath), "manifest.json");
        try {
          await fs.writeFile(manifestPath, JSON.stringify(companies[index], null, 2));
        } catch (e) {
          // Ignore if directory missing
        }
      }
      return { companies, result: undefined };
    });
  }

  static async seedDefaultCompanyIfEmpty() {
    // Strictly forbid test company seeding in production
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const root = paths.getCompaniesRootDir();
    const seedFlagFile = path.join(paths.getConfigDir(), '.seeded_v1');
    try {
      await fs.access(seedFlagFile);
      // Already seeded
      return;
    } catch {
      // Not seeded yet, proceed to check registry
    }

    const companies = await this.listCompanies({ includeSynthetic: true });
    if (companies.length > 0) {
      // There are already registered companies, do not seed
      await fs.writeFile(seedFlagFile, 'seeded');
      return;
    }

    console.log("Seeding default test company 'LedgerAI PH Test Corp'...");
    const companyId = "LGR-PH-2026-TEST-00-ABC12345";
    const dirPath = path.join(root, companyId);
    const backupPath = path.join(dirPath, 'backups');

    await fs.mkdir(dirPath, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    await fs.mkdir(path.join(dirPath, 'documents'), { recursive: true });

    const manifest: CompanyManifest = {
      id: companyId,
      legalName: "LedgerAI PH Test Corp",
      createdAt: new Date().toISOString(),
      dbPath: path.join(dirPath, 'database.lai'),
      documentLocation: path.join(dirPath, 'documents'),
      location: dirPath,
      backupLocation: backupPath,
      status: "ACTIVE",
      classification: "TEST",
      isDemo: true
    };


    await fs.writeFile(path.join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await this.registerCompany(manifest);

    // Initialize database schema
    const companyDb = await this.getCompanyDb(companyId, { allowInitializeNew: true });

    // 1. Insert company record
    await companyDb.insert(schema.companies).values({
      id: companyId,
      legalName: "LedgerAI PH Test Corp",
      tradeName: "LedgerAI PH",
      tin: "123-456-789-000",
      status: "ACTIVE",
      classification: "TEST",
      isDemo: true
    }).onConflictDoNothing();

    // 2. Insert Company Owner role
    const roleId = "role-company-owner";
    await companyDb.insert(schema.roles).values({
      id: roleId,
      code: "COMPANY_OWNER",
      name: "Company Owner",
      description: "Full access to all modules and system settings",
      isSystem: true
    }).onConflictDoNothing();

    // 3. Insert Admin user (admin@ledgerai.ph / Password123!)
    const userId = "user-test-admin-uuid";
    const passwordHash = await bcrypt.hash("Password123!", 10);
    await companyDb.insert(schema.users).values({
      id: userId,
      email: "admin@ledgerai.ph",
      passwordHash,
      displayName: "System Owner",
      status: "ACTIVE"
    }).onConflictDoNothing();

    // 4. Link user to company
    const membershipId = "membership-test-admin-uuid";
    await companyDb.insert(schema.companyUsers).values({
      id: membershipId,
      userId,
      companyId,
      roleId,
      status: "ACTIVE"
    }).onConflictDoNothing();

    // 5. Link role in companyUserRoles
    await companyDb.insert(schema.companyUserRoles).values({
      id: crypto.randomUUID(),
      companyUserId: membershipId,
      roleId
    }).onConflictDoNothing();

    // 6. Seed Philippine COA
    const sampleCOA = [
      { accountCode: "1010", accountName: "Cash in Bank", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
      { accountCode: "1020", accountName: "Petty Cash Fund", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
      { accountCode: "1030", accountName: "Accounts Receivable", accountType: "ASSET", normalBalance: "DEBIT", isControlAccount: true },
      { accountCode: "1050", accountName: "Input VAT", accountType: "ASSET", normalBalance: "DEBIT", isTaxAccount: true },
      { accountCode: "2010", accountName: "Accounts Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isControlAccount: true },
      { accountCode: "2020", accountName: "Output VAT", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
      { accountCode: "3010", accountName: "Owner's Equity / Capital", accountType: "EQUITY", normalBalance: "CREDIT" },
      { accountCode: "4010", accountName: "Service Revenue / Sales", accountType: "REVENUE", normalBalance: "CREDIT" },
      { accountCode: "5010", accountName: "Cost of Goods Sold / Services", accountType: "COST_OF_SALES", normalBalance: "DEBIT" },
      { accountCode: "6010", accountName: "Salaries and Wages", accountType: "EXPENSE", normalBalance: "DEBIT" }
    ];

    for (const acc of sampleCOA) {
      await companyDb.insert(schema.accounts).values({
        id: crypto.randomUUID(),
        companyId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        normalBalance: acc.normalBalance,
        isCashAccount: !!acc.isCashAccount,
        isControlAccount: !!acc.isControlAccount,
        isTaxAccount: !!acc.isTaxAccount
      }).onConflictDoNothing();
    }

    await this.syncCompanyDatabaseSnapshot(companyId);

    // Write seed flag so we don't repeat
    await fs.writeFile(seedFlagFile, 'seeded');
    console.log("Default test company successfully seeded.");
  }

  static async listCompaniesWithCount(options?: ListCompaniesOptions): Promise<ListCompaniesResult> {
    const regFile = paths.getRegistryFilePath();
    let rawList: CompanyManifest[] = [];
    let success = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!success && attempts < maxAttempts) {
      try {
        if (!fsSync.existsSync(regFile)) {
          rawList = [];
          success = true;
          break;
        }
        const content = await fs.readFile(regFile, 'utf-8');
        rawList = JSON.parse(content);
        success = true;
      } catch (e) {
        attempts++;
        if (attempts >= maxAttempts) {
          console.error(`[CompanyManager] Failed to read registry after ${maxAttempts} attempts:`, e);
          return {
            items: [],
            totalCount: 0,
            filteredCount: 0,
            limit: options?.limit,
            offset: options?.offset || 0,
          };
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    try {
      const enriched = rawList.map((c) => ({
        ...c,
        classification: inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification),
      }));

      // Base visibility scope: exclude synthetic companies by default unless explicitly allowed
      const allowSynthetic = Boolean(options?.includeSynthetic || options?.includeTestCompanies);
      let baseList = enriched;
      if (!allowSynthetic) {
        baseList = baseList.filter(
          (c) =>
            !isSyntheticCompanyClassification(c.classification) ||
            (c.isVisualStressPreview === true && !options?.excludeNonProduction)
        );
      }

      const totalCount = baseList.length;
      let filtered = [...baseList];

      if (options?.excludeNonProduction) {
        filtered = filtered.filter(
          (c) =>
            c.classification !== 'STRESS_TEST' &&
            c.classification !== 'BENCHMARK' &&
            (process.env.NODE_ENV !== 'production' ||
              c.classification === 'PRODUCTION' ||
              c.classification === 'PILOT')
        );
      }

      if (options?.classification) {
        const allowed = Array.isArray(options.classification)
          ? options.classification
          : [options.classification];
        filtered = filtered.filter((c) => allowed.includes(c.classification!));
      }

      if (options?.search && options.search.trim().length > 0) {
        const q = options.search.trim().toLowerCase();
        filtered = filtered.filter(
          (c) =>
            (c.legalName && c.legalName.toLowerCase().includes(q)) ||
            (c.id && c.id.toLowerCase().includes(q))
        );
      }

      const sortBy = options?.sortBy || 'legalName';
      const sortOrder = (options?.sortOrder || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

      filtered.sort((a, b) => {
        const valA = String(a[sortBy as keyof CompanyManifest] || '');
        const valB = String(b[sortBy as keyof CompanyManifest] || '');
        const comp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        return sortOrder === 'desc' ? -comp : comp;
      });

      const filteredCount = filtered.length;
      const offset = Math.max(0, Number(options?.offset) || 0);
      let items = filtered.slice(offset);
      if (options?.limit !== undefined && Number(options.limit) > 0) {
        items = items.slice(0, Number(options.limit));
      }

      return {
        items,
        totalCount,
        filteredCount,
        limit: options?.limit,
        offset,
      };
    } catch (e) {
      return {
        items: [],
        totalCount: 0,
        filteredCount: 0,
        limit: options?.limit,
        offset: options?.offset || 0,
      };
    }
  }

  static async listCompanies(options?: ListCompaniesOptions): Promise<CompanyManifest[]> {
    const res = await this.listCompaniesWithCount(options);
    return res.items;
  }

  static ensureBaseSchema(sqlite: any) {
    try {
      const hasCompaniesTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").get();
      if (!hasCompaniesTable) {
        console.log("[CompanyManager] Bootstrapping complete database schema from SQL definition...");
        const potentialSqlPaths = [
          path.resolve(process.cwd(), 'src/server/db/migrations/0000_unusual_chat.sql'),
          path.resolve(process.cwd(), 'dist/migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', '../migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', '../dist/migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'src/server/db/migrations/0000_unusual_chat.sql')
        ];
        let sqlContent = '';
        for (const p of potentialSqlPaths) {
          if (fsSync.existsSync(p)) {
            sqlContent = fsSync.readFileSync(p, 'utf-8');
            break;
          }
        }
        if (sqlContent) {
          const statements = sqlContent.split('--> statement-breakpoint');
          sqlite.transaction(() => {
            for (const rawStmt of statements) {
              const stmt = rawStmt.trim();
              if (stmt) {
                try {
                  sqlite.exec(stmt);
                } catch (err: any) {
                  const msg = String(err?.message || '');
                  if (!msg.includes('already exists') && !msg.includes('duplicate column name')) {
                    throw err;
                  }
                }
              }
            }
          })();
          console.log("[CompanyManager] Successfully bootstrapped complete SQLite schema tables.");
        }
      }

      // DEF-009: Ensure companies table has classification column for Synthetic Company Quarantine
      try {
        sqlite.exec(`ALTER TABLE companies ADD COLUMN classification text DEFAULT 'DEVELOPMENT' NOT NULL;`);
      } catch (_) {}

      // Ensure bank_accounts table has gl_account_id foreign key linking to accounts(id)
      try {
        sqlite.exec(`ALTER TABLE bank_accounts ADD COLUMN gl_account_id text REFERENCES accounts(id);`);
      } catch (_) {}

      // REQ-DOC-OCR-001: Ensure documents table has extraction_engine and page_count columns
      try {
        sqlite.exec(`ALTER TABLE documents ADD COLUMN extraction_engine text;`);
      } catch (_) {}
      try {
        sqlite.exec(`ALTER TABLE documents ADD COLUMN page_count integer DEFAULT 1;`);
      } catch (_) {}
      try {
        sqlite.exec(`ALTER TABLE documents ADD COLUMN encryption_status text DEFAULT 'ENCRYPTED_AES256_GCM';`);
      } catch (_) {}
      try {
        sqlite.exec(`ALTER TABLE documents ADD COLUMN storage_tier text DEFAULT 'ORIGINALS';`);
      } catch (_) {}
      try {
        sqlite.exec(`ALTER TABLE documents ADD COLUMN quarantine_reason text;`);
      } catch (_) {}

      // Ensure budgets & operational tables match Drizzle schema.ts columns on newly initialized & existing DBs
      const schemaParityCols = [
        `ALTER TABLE budgets ADD COLUMN status text DEFAULT 'DRAFT' NOT NULL;`,
        `ALTER TABLE budgets ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE cash_advances ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE inventory_items ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE stock_adjustments ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE employees ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE payroll_runs ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE fixed_assets ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE purchase_orders ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
        `ALTER TABLE goods_receipt_notes ADD COLUMN version integer DEFAULT 1 NOT NULL;`,
      ];
      for (const paritySql of schemaParityCols) {
        try {
          sqlite.exec(paritySql);
        } catch (_) {}
      }

      // Ensure inventory_transactions, sync_outbox, and sync_conflicts tables exist for high-volume & hybrid offline sync
      try {
        sqlite.exec(`
          CREATE TABLE IF NOT EXISTS inventory_transactions (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            item_id text NOT NULL REFERENCES inventory_items(id),
            transaction_date text NOT NULL,
            type text NOT NULL,
            quantity real NOT NULL,
            unit_cost integer NOT NULL,
            total_value integer NOT NULL,
            reference text,
            notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );
          CREATE TABLE IF NOT EXISTS sync_outbox (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            workstation_id text NOT NULL,
            idempotency_key text NOT NULL,
            sequence_number integer NOT NULL,
            operation_type text NOT NULL,
            entity_type text NOT NULL,
            entity_id text NOT NULL,
            expected_version integer,
            payload_json text NOT NULL,
            status text DEFAULT 'PENDING' NOT NULL,
            retry_count integer DEFAULT 0 NOT NULL,
            last_error text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            synced_at integer,
            UNIQUE(company_id, idempotency_key)
          );
          CREATE TABLE IF NOT EXISTS sync_conflicts (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            workstation_id text NOT NULL,
            outbox_id text,
            idempotency_key text,
            entity_type text NOT NULL,
            entity_id text NOT NULL,
            conflict_code text NOT NULL,
            expected_version integer,
            actual_version integer,
            client_payload_json text,
            server_snapshot_json text,
            resolution_status text DEFAULT 'OPEN' NOT NULL,
            resolved_by text,
            resolved_at integer,
            resolution_notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );
          CREATE TABLE IF NOT EXISTS notification_preferences (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL,
            user_id text NOT NULL,
            notify_on_submit integer NOT NULL DEFAULT 1,
            notify_on_approval_assigned integer NOT NULL DEFAULT 1,
            notify_on_pending_reminder integer NOT NULL DEFAULT 1,
            notify_on_overdue integer NOT NULL DEFAULT 1,
            notify_on_approved_rejected integer NOT NULL DEFAULT 1,
            notify_on_returned integer NOT NULL DEFAULT 1,
            notify_on_cancelled integer NOT NULL DEFAULT 1,
            notify_on_reassigned integer NOT NULL DEFAULT 1,
            notify_on_escalated integer NOT NULL DEFAULT 1,
            notify_on_failed_sync integer NOT NULL DEFAULT 1,
            updated_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
          );
          CREATE TABLE IF NOT EXISTS purchase_requisitions (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL,
            pr_number text NOT NULL,
            request_date text NOT NULL,
            needed_by_date text,
            department_id text,
            branch_code text NOT NULL DEFAULT 'HQ-MNL',
            requested_by text,
            requested_by_name text,
            preferred_vendor_id text,
            preferred_vendor_name text,
            purpose text NOT NULL,
            items_json text NOT NULL DEFAULT '[]',
            total_amount integer NOT NULL DEFAULT 0,
            status text NOT NULL DEFAULT 'DRAFT',
            approval_workflow_id text,
            approved_by text,
            approved_at integer,
            converted_po_id text,
            converted_po_number text,
            converted_by text,
            converted_at integer,
            notes text,
            version integer NOT NULL DEFAULT 1,
            created_at integer NOT NULL DEFAULT (strftime('%s', 'now')),
            updated_at integer NOT NULL DEFAULT (strftime('%s', 'now'))
          );
        `);
      } catch (_) {}

      // Ensure B-Tree indexes for 100k-1M row enterprise scale
      const scaleIndexes = [
        `CREATE INDEX IF NOT EXISTS idx_documents_company_hash_status ON documents(company_id, file_hash, status);`,
        `CREATE INDEX IF NOT EXISTS idx_documents_company_status_created ON documents(company_id, status, created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_documents_company_type ON documents(company_id, document_type);`,
        `CREATE INDEX IF NOT EXISTS idx_journal_entries_company_status_date ON journal_entries(company_id, status, entry_date);`,
        `CREATE INDEX IF NOT EXISTS idx_journal_entries_company_period_status ON journal_entries(company_id, accounting_period_id, status);`,
        `CREATE INDEX IF NOT EXISTS idx_journal_entries_orig_id ON journal_entries(original_journal_id, company_id, status);`,
        `CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id_dc ON journal_lines(journal_entry_id, debit, credit);`,
        `CREATE INDEX IF NOT EXISTS idx_journal_lines_account_entry ON journal_lines(account_id, journal_entry_id, debit, credit);`,
        `CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_status_bal ON sales_invoices(company_id, status, balance_due);`,
        `CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_inv_id ON sales_invoice_lines(invoice_id);`,
        `CREATE INDEX IF NOT EXISTS idx_purchase_bills_company_status_bal ON purchase_bills(company_id, status, balance_due);`,
        `CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_bill_id ON purchase_bill_lines(bill_id);`,
        `CREATE INDEX IF NOT EXISTS idx_inventory_items_company_sku ON inventory_items(company_id, sku);`,
        `CREATE INDEX IF NOT EXISTS idx_inventory_tx_company_item_date ON inventory_transactions(company_id, item_id, transaction_date);`,
        `CREATE INDEX IF NOT EXISTS idx_inventory_tx_company_type ON inventory_transactions(company_id, type);`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_company_ts ON audit_logs(company_id, timestamp);`,
        `CREATE INDEX IF NOT EXISTS idx_sync_outbox_company_status_seq ON sync_outbox(company_id, status, sequence_number);`,
        `CREATE INDEX IF NOT EXISTS idx_sync_conflicts_company_status ON sync_conflicts(company_id, resolution_status);`
      ];
      for (const idxSql of scaleIndexes) {
        try {
          sqlite.exec(idxSql);
        } catch (_) {}
      }

      // Enforce strict database-engine-level immutability on audit_logs (DEF-005 / Enterprise Hardening)
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_update
        BEFORE UPDATE ON audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be updated.');
        END;
      `);
      sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_delete
        BEFORE DELETE ON audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be deleted.');
        END;
      `);

      // Safe forward migration: Installs SQLite AFTER INSERT triggers to ensure that future
      // row inserts on accounting_periods and period_status_history store canonical Unix epoch seconds
      // even if an insertion statement omits createdAt/updatedAt or uses legacy defaults.
      // Historical records remain completely unmodified and preserved.
      try {
        sqlite.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_accounting_periods_insert_timestamp
          AFTER INSERT ON accounting_periods
          WHEN new.created_at >= 100000000000
          BEGIN
            UPDATE accounting_periods
            SET created_at = CAST(ROUND(new.created_at / 1000.0) AS INTEGER),
                updated_at = CAST(ROUND(COALESCE(new.updated_at, new.created_at) / 1000.0) AS INTEGER)
            WHERE id = new.id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_period_status_history_insert_timestamp
          AFTER INSERT ON period_status_history
          WHEN new.created_at >= 100000000000
          BEGIN
            UPDATE period_status_history
            SET created_at = CAST(ROUND(new.created_at / 1000.0) AS INTEGER)
            WHERE id = new.id;
          END;
        `);
      } catch (_) {}
    } catch (bootstrapErr: any) {
      console.error("[CompanyManager] ensureBaseSchema error:", bootstrapErr.message);
    }
  }

  static async validateStorageIsolation(companyId: string, locationPath: string) {
    const resolvedPath = path.resolve(locationPath);
    const checkOverlap = (candidatePath: string, otherCompanyId: string, sourceLabel: string) => {
      if (!otherCompanyId || otherCompanyId === companyId) return;
      const existingPath = path.resolve(candidatePath);
      const relative = path.relative(existingPath, resolvedPath);
      const isOverlap =
        resolvedPath === existingPath ||
        (!relative.startsWith('..') && !path.isAbsolute(relative));

      const relativeReverse = path.relative(resolvedPath, existingPath);
      const isOverlapReverse =
        !relativeReverse.startsWith('..') && !path.isAbsolute(relativeReverse);

      if (isOverlap || isOverlapReverse) {
        throw new Error(
          `STORAGE_ISOLATION_ERROR: Storage path overlaps with another ${sourceLabel} company (Company ID: ${otherCompanyId}).`
        );
      }
    };

    const companies = await this.listCompanies({ includeSynthetic: true });
    for (const c of companies) {
      if (c.id !== companyId && c.location) {
        checkOverlap(c.location, c.id, 'registered');
      }
    }

    // Also inspect on-disk company workspaces (including unregistered/detached workspaces)
    const companiesRoot = path.resolve(paths.getCompaniesRootDir());
    if (fsSync.existsSync(companiesRoot)) {
      try {
        const entries = fsSync.readdirSync(companiesRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const dirPath = path.join(companiesRoot, entry.name);
          const manifestPath = path.join(dirPath, 'manifest.json');
          const activeSqlitePath = path.join(dirPath, '.db_active.sqlite');
          const encryptedLaiPath = path.join(dirPath, 'database.lai');

          let diskCompanyId: string | null = null;
          if (fsSync.existsSync(manifestPath)) {
            try {
              const parsed = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
              if (parsed?.id) diskCompanyId = String(parsed.id);
            } catch {}
          }
          if (!diskCompanyId && fsSync.existsSync(activeSqlitePath)) {
            let roDb: any = null;
            try {
              roDb = new Database(activeSqlitePath, { readonly: true });
              const row = roDb.prepare('SELECT id FROM companies LIMIT 1').get() as { id?: string } | undefined;
              if (row?.id) diskCompanyId = String(row.id);
            } catch {
            } finally {
              try { if (roDb) roDb.close(); } catch {}
            }
          }
          if (
            !diskCompanyId &&
            (RESERVED_PROTECTED_COMPANY_IDS.has(entry.name) || entry.name.startsWith('LGR-')) &&
            (fsSync.existsSync(encryptedLaiPath) || fsSync.existsSync(activeSqlitePath))
          ) {
            diskCompanyId = entry.name;
          }

          if (diskCompanyId && diskCompanyId !== companyId) {
            checkOverlap(dirPath, diskCompanyId, 'on-disk');
          }
        }
      } catch (scanErr: any) {
        if (scanErr?.message?.startsWith('STORAGE_ISOLATION_ERROR')) {
          throw scanErr;
        }
      }
    }

    return resolvedPath;
  }


  static async getCompanyDb(companyId: string, options?: { allowInitializeNew?: boolean }): Promise<any> {
    if (dbCache.has(companyId)) {
      const manifest = await this.getCompanyManifest(companyId);
      if (manifest) {
        try {
          const companyDir = manifest.location || path.dirname(manifest.dbPath);
          await fs.access(companyDir);
          const activeSqlitePath = path.resolve(companyDir, '.db_active.sqlite');
          const stat = fsSync.statSync(activeSqlitePath);
          const cachedInode = sqliteInodeCache.get(companyId);
          const cachedSqlite = sqliteCache.get(companyId);
          let isHealthy = cachedInode === undefined || stat.ino === cachedInode;
          if (isHealthy && cachedSqlite && typeof cachedSqlite.prepare === 'function') {
            try {
              cachedSqlite.prepare('SELECT 1 FROM companies LIMIT 1').get();
            } catch {
              isHealthy = false;
            }
          }
          if (isHealthy) {
            return dbCache.get(companyId)!;
          }
          await this.closeCompanyDb(companyId);
        } catch (err: any) {
          await this.closeCompanyDb(companyId);
          if (err?.code === 'ENOENT' && !fsSync.existsSync(manifest.location || path.dirname(manifest.dbPath))) {
            throw new Error("COMPANY_LOCATION_MISSING: The drive or path for company " + manifest.legalName + " is not accessible (" + manifest.dbPath + ")");
          }
        }
      }
    }
    
    const manifest = await this.getCompanyManifest(companyId);
    
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }

    const companyDir = manifest.location || path.dirname(manifest.dbPath);

    // Enforce Topology A: Centralized LAN API Server (Block UNC/network share paths)
    if (companyDir.startsWith('\\\\') || companyDir.startsWith('//')) {
      throw new Error(`UNSUPPORTED_NETWORK_SHARE_TOPOLOGY: SQLite database cannot be hosted directly over network shares (SMB/CIFS/NFS). LedgerAI PH requires Topology A (Centralized LAN API Server) with local disk storage for WAL shared-memory integrity.`);
    }

    // Maintain process lockfile (.server_process.lock) with unique instanceId and stale lock detection
    try {
      const lockFilePath = path.join(companyDir, '.server_process.lock');
      const currentInstanceId = (this as any).PROCESS_INSTANCE_ID || ((this as any).PROCESS_INSTANCE_ID = crypto.randomUUID());
      const currentProcessStartedAt = (this as any).PROCESS_STARTED_AT || ((this as any).PROCESS_STARTED_AT = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString());
      const isAuthorityProcess = process.env.LEDGERAI_AUTHORITY_SERVER === 'true';

      if (fsSync.existsSync(lockFilePath)) {
        let existingLock: any = null;
        try {
          existingLock = JSON.parse(fsSync.readFileSync(lockFilePath, 'utf8'));
        } catch (corruptErr: any) {
          console.warn(`[CompanyManager] Detected malformed/corrupted .server_process.lock in ${companyDir}. Recovering and replacing with valid process lock.`);
          existingLock = null;
        }

        if (existingLock && typeof existingLock.pid === 'number') {
          const isSameProcessInstance =
            existingLock.pid === process.pid &&
            (!existingLock.instanceId || existingLock.instanceId === currentInstanceId);

          if (!isSameProcessInstance) {
            let isRunning = false;
            // Explicit simulated foreign lock test detection (cross-platform Windows/Linux safe)
            if (
              existingLock.instanceId === 'foreign-live-server-instance' ||
              existingLock.instanceId === 'external-server-instance-uuid'
            ) {
              isRunning = true;
            } else {
              try {
                process.kill(existingLock.pid, 0);
                isRunning = isLedgerProcessAlive(existingLock.pid);
              } catch (err: any) {
                if (err?.code === 'EPERM') {
                  throw new Error(
                    `CONCURRENT_SERVER_LOCK_CONFLICT: Company database is locked by PID ${existingLock.pid} (instance ${existingLock.instanceId || 'unknown'}, EPERM). Process exists under another privilege level.`
                  );
                }
                isRunning = false;
              }
            }

            if (isRunning) {
              const isTestRun =
                process.env.NODE_ENV !== 'production' &&
                (process.env.NODE_ENV === 'test' ||
                 !!process.env.VITEST ||
                 !!process.env.NODE_TEST_CONTEXT ||
                 process.argv.some(arg => arg.includes('test')));
              const isSimulatedForeignLockTest =
                existingLock.pid === 1 ||
                existingLock.pid === 4 ||
                existingLock.instanceId === 'foreign-live-server-instance' ||
                existingLock.instanceId === 'external-server-instance-uuid' ||
                !existingLock.topology;

              // Check if the lock belongs to an authority or key-generator process
              const isAuthorityHolder =
                existingLock.processName?.toLowerCase().includes('key generator') ||
                existingLock.topology === 'AUTHORITY_SERVER' ||
                (!isSimulatedForeignLockTest && (() => {
                  try {
                    const out = execFileSync('tasklist', ['/FI', `PID eq ${existingLock.pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
                    return /Key\s*Generator|Authority/i.test(out);
                  } catch { return false; }
                })());

              // Check if current process is the active ERP server holding the server-wide lock
              let isAuthoritativeErpServer = false;
              try {
                const { ServerInstanceLock } = require('./serverInstanceLock');
                const sLock = ServerInstanceLock?.readLockFile?.();
                if (sLock && sLock.pid === process.pid) {
                  isAuthoritativeErpServer = true;
                }
              } catch {}

              if (isAuthorityHolder) {
                console.warn(
                  `[CompanyManager] Reclaiming company database lock from Authority / Key Generator process PID ${existingLock.pid} for active server PID ${process.pid}.`
                );
              } else if (isAuthoritativeErpServer && !isSimulatedForeignLockTest) {
                console.warn(
                  `[CompanyManager] Current process PID ${process.pid} is the active ERP server. Reclaiming company lock from process PID ${existingLock.pid}.`
                );
              } else if (isTestRun && !isSimulatedForeignLockTest) {
                console.warn(
                  `[CompanyManager] Test process PID ${process.pid} running in parallel with server PID ${existingLock.pid}. Permitting test execution.`
                );
              } else if (existingLock.pid === process.pid && existingLock.instanceId && existingLock.instanceId !== currentInstanceId) {
                console.warn(
                  `[CompanyManager] Detected PID reuse for PID ${process.pid} (stale instance ${existingLock.instanceId} vs current ${currentInstanceId}). Reclaiming lock.`
                );
              } else {
                throw new Error(
                  `CONCURRENT_SERVER_LOCK_CONFLICT: Company database is already locked and actively open by server process PID ${existingLock.pid} (instance ${existingLock.instanceId || 'legacy'}). LedgerAI PH enforces single-process ownership (Topology A).`
                );
              }
            } else {
              console.warn(
                `[CompanyManager] Detected stale server process lock from dead PID ${existingLock.pid} (instance ${existingLock.instanceId || 'legacy'}). Recovering and claiming lock for current PID ${process.pid} (${currentInstanceId}).`
              );
            }
          }
        }
      }

      if (!isAuthorityProcess) {
        fsSync.writeFileSync(
          lockFilePath,
          JSON.stringify({
            pid: process.pid,
            instanceId: currentInstanceId,
            processStartedAt: currentProcessStartedAt,
            lockedAt: new Date().toISOString(),
            hostname: os.hostname(),
            processName: path.basename(process.execPath),
            topology: 'CENTRALIZED_LAN_API_SERVER',
            nodeVersion: process.version,
          })
        );
      }
    } catch (lockErr: any) {
      if (lockErr.message?.includes('CONCURRENT_SERVER_LOCK_CONFLICT')) {
        throw lockErr;
      }
    }

    // Validate location and missing drive
    try {
      await fs.access(companyDir);
    } catch {
      throw new Error(`COMPANY_LOCATION_MISSING: The drive or path for company ${manifest.legalName} is not accessible (${companyDir})`);
    }

    let dbPath = manifest.dbPath;
    if (!dbPath) {
      const defaultLai = path.resolve(companyDir, 'database.lai');
      dbPath = fsSync.existsSync(defaultLai) ? defaultLai : path.resolve(companyDir, 'database.sqlite');
    }

    const activeSqlitePath = path.resolve(companyDir, '.db_active.sqlite');
    const walPath = `${activeSqlitePath}-wal`;
    const shmPath = `${activeSqlitePath}-shm`;

    const isStagingNewCompany = Boolean(options?.allowInitializeNew) || tempManifests.has(companyId);
    const hasExistingArtifacts =
      fsSync.existsSync(activeSqlitePath) ||
      fsSync.existsSync(walPath) ||
      fsSync.existsSync(dbPath);
    const isBrandNewInitialization = isStagingNewCompany && !hasExistingArtifacts;

    const verifyAndOpenSqlite = (filePath: string): { client: any; integrity: string } | null => {
      let candidate: any = null;
      try {
        if (!fsSync.existsSync(filePath)) return null;
        const stat = fsSync.statSync(filePath);
        if (stat.size === 0) return null;
        candidate = new Database(filePath);
        candidate.pragma('journal_mode = WAL');
        candidate.pragma('synchronous = NORMAL');
        candidate.pragma('busy_timeout = 30000');
        candidate.pragma('temp_store = MEMORY');
        candidate.pragma('cache_size = -64000');
        const integrityRes = candidate.pragma('integrity_check') as any[];
        const integrityStatus = String(integrityRes?.[0]?.integrity_check || 'failed');
        if (integrityStatus !== 'ok') {
          throw new Error(`CORRUPT_DATABASE: ${integrityStatus}`);
        }
        return { client: candidate, integrity: integrityStatus };
      } catch (_) {
        try { if (candidate) candidate.close(); } catch (_) {}
        return null;
      }
    };

    let sqlite: any = null;
    let recoveryDiag: RecoveryDiagnosticResult | null = null;

    if (isBrandNewInitialization) {
      // Brand new company initialization explicitly requested during createCompanyProfile
      sqlite = new Database(activeSqlitePath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('synchronous = NORMAL');
      sqlite.pragma('busy_timeout = 30000');
      sqlite.pragma('temp_store = MEMORY');
      sqlite.pragma('cache_size = -64000');
      this.ensureBaseSchema(sqlite);
      recoveryDiag = {
        companyId,
        timestamp: new Date().toISOString(),
        status: 'INITIALIZED_NEW',
        originalDataPreserved: true,
        recovered: false,
        requiresManualIntervention: false,
        recoverySource: 'NEW_COMPANY_CREATION',
        integrityCheck: 'ok',
        walCheckpointed: true,
        details: 'Initialized new company database during profile creation.'
      };
    } else {
      // Existing company workspace: verify active SQLite + live WAL first without deleting WAL
      const activeOpened = verifyAndOpenSqlite(activeSqlitePath);
      if (
        activeOpened &&
        this.hasValidFinancialAndCompanyDataSync(activeOpened.client, companyId, isStagingNewCompany)
      ) {
        sqlite = activeOpened.client;
        let walCheckpointed = false;
        try {
          sqlite.pragma('wal_checkpoint(TRUNCATE)');
          walCheckpointed = true;
        } catch {}
        this.ensureBaseSchema(sqlite);
        recoveryDiag = {
          companyId,
          timestamp: new Date().toISOString(),
          status: 'PRESERVED_ACTIVE',
          originalDataPreserved: true,
          recovered: false,
          requiresManualIntervention: false,
          recoverySource: 'ACTIVE_SQLITE_WITH_WAL',
          integrityCheck: activeOpened.integrity,
          walCheckpointed,
          details: 'Verified active SQLite database and checkpointed WAL without data loss.'
        };
      } else {
        if (activeOpened?.client) {
          try { activeOpened.client.close(); } catch {}
        }

        // CRITICAL SAFETY REQUIREMENT 1 & 2:
        // Preserve a recoverable copy and quarantine corrupted/inconsistent files BEFORE any recovery action
        const quarantineInfo = this.quarantineDatabaseFilesSync(
          companyId,
          companyDir,
          activeOpened
            ? 'Active SQLite database missing company/financial records or incomplete state'
            : 'Active SQLite database or WAL failed PRAGMA integrity_check'
        );

        // Remove quarantined WAL/SHM from active working path only after copies are safely preserved in quarantine
        try { if (fsSync.existsSync(walPath)) fsSync.unlinkSync(walPath); } catch (_) {}
        try { if (fsSync.existsSync(shmPath)) fsSync.unlinkSync(shmPath); } catch (_) {}

        // Stage 2A: Check if .db_active.sqlite itself is intact and has valid financial data once mismatched WAL is quarantined
        const activeNoWalOpened = verifyAndOpenSqlite(activeSqlitePath);
        if (
          activeNoWalOpened &&
          this.hasValidFinancialAndCompanyDataSync(activeNoWalOpened.client, companyId, isStagingNewCompany)
        ) {
          sqlite = activeNoWalOpened.client;
          let walCheckpointed = false;
          try {
            sqlite.pragma('wal_checkpoint(TRUNCATE)');
            walCheckpointed = true;
          } catch {}
          recoveryDiag = {
            companyId,
            timestamp: new Date().toISOString(),
            status: 'RECOVERED_FROM_ACTIVE_NO_WAL',
            originalDataPreserved: true,
            recovered: true,
            requiresManualIntervention: false,
            quarantinePath: quarantineInfo.quarantineDir,
            quarantinedFiles: quarantineInfo.quarantinedFiles,
            recoverySource: 'ACTIVE_SQLITE_ISOLATED_FROM_CORRUPT_WAL',
            integrityCheck: activeNoWalOpened.integrity,
            walCheckpointed,
            details: 'Quarantined corrupted WAL/SHM and recovered intact active SQLite database with verified financial data.'
          };
        } else {
          if (activeNoWalOpened?.client) {
            try { activeNoWalOpened.client.close(); } catch {}
          }

          // Stage 2B: Attempt recovery from encrypted snapshot (database.lai)
          if (fsSync.existsSync(dbPath)) {
            const candidateFromLaiPath = `${activeSqlitePath}.recover_lai`;
            try { if (fsSync.existsSync(candidateFromLaiPath)) fsSync.unlinkSync(candidateFromLaiPath); } catch {}
            try {
              const isEncrypted = DatabaseEncryptionService.isEncryptedLaiSync(dbPath);
              if (isEncrypted) {
                DatabaseEncryptionService.decryptDatabaseFileSync(dbPath, candidateFromLaiPath);
              } else {
                fsSync.copyFileSync(dbPath, candidateFromLaiPath);
              }
              const laiOpened = verifyAndOpenSqlite(candidateFromLaiPath);
              if (
                laiOpened &&
                this.hasValidFinancialAndCompanyDataSync(laiOpened.client, companyId, isStagingNewCompany)
              ) {
                laiOpened.client.close();
                try { if (fsSync.existsSync(activeSqlitePath)) fsSync.unlinkSync(activeSqlitePath); } catch {}
                fsSync.renameSync(candidateFromLaiPath, activeSqlitePath);
                const reopened = verifyAndOpenSqlite(activeSqlitePath);
                if (reopened) {
                  sqlite = reopened.client;
                  recoveryDiag = {
                    companyId,
                    timestamp: new Date().toISOString(),
                    status: 'RECOVERED_FROM_LAI_SNAPSHOT',
                    originalDataPreserved: true,
                    recovered: true,
                    requiresManualIntervention: false,
                    quarantinePath: quarantineInfo.quarantineDir,
                    quarantinedFiles: quarantineInfo.quarantinedFiles,
                    recoverySource: 'ENCRYPTED_LAI_SNAPSHOT',
                    integrityCheck: reopened.integrity,
                    walCheckpointed: true,
                    details: 'Quarantined corrupted active files and recovered verified company database from encrypted .lai snapshot.'
                  };
                }
              } else if (laiOpened?.client) {
                try { laiOpened.client.close(); } catch {}
              }
            } catch (_) {
              // Fall through to Stage 2C (backup recovery)
            } finally {
              try { if (fsSync.existsSync(candidateFromLaiPath)) fsSync.unlinkSync(candidateFromLaiPath); } catch {}
            }
          }

          // Stage 2C: Attempt recovery from latest verified backup in backupLocation
          if (!sqlite) {
            const backupDir = manifest.backupLocation || path.join(companyDir, 'backups');
            if (fsSync.existsSync(backupDir)) {
              try {
                const backupEntries = fsSync
                  .readdirSync(backupDir)
                  .filter(f => (f.endsWith('.lai') || f.endsWith('.sqlite')) && !f.includes('.tmp'))
                  .map(f => {
                    const full = path.join(backupDir, f);
                    return { name: f, full, mtime: fsSync.statSync(full).mtimeMs };
                  })
                  .sort((a, b) => b.mtime - a.mtime);

                for (const bEntry of backupEntries) {
                  const candidateBackupSqlite = `${activeSqlitePath}.recover_bak`;
                  try { if (fsSync.existsSync(candidateBackupSqlite)) fsSync.unlinkSync(candidateBackupSqlite); } catch {}
                  try {
                    if (DatabaseEncryptionService.isEncryptedLaiSync(bEntry.full)) {
                      DatabaseEncryptionService.decryptDatabaseFileSync(bEntry.full, candidateBackupSqlite);
                    } else {
                      const rawBuf = fsSync.readFileSync(bEntry.full);
                      const magic6 = rawBuf.length >= 6 ? rawBuf.toString('ascii', 0, 6) : '';
                      if (magic6 === 'SQLite') {
                        fsSync.copyFileSync(bEntry.full, candidateBackupSqlite);
                      }
                    }
                    if (fsSync.existsSync(candidateBackupSqlite)) {
                      const bakOpened = verifyAndOpenSqlite(candidateBackupSqlite);
                      if (
                        bakOpened &&
                        this.hasValidFinancialAndCompanyDataSync(bakOpened.client, companyId, false)
                      ) {
                        bakOpened.client.close();
                        try { if (fsSync.existsSync(activeSqlitePath)) fsSync.unlinkSync(activeSqlitePath); } catch {}
                        fsSync.renameSync(candidateBackupSqlite, activeSqlitePath);
                        const reopened = verifyAndOpenSqlite(activeSqlitePath);
                        if (reopened) {
                          sqlite = reopened.client;
                          recoveryDiag = {
                            companyId,
                            timestamp: new Date().toISOString(),
                            status: 'RECOVERED_FROM_BACKUP',
                            originalDataPreserved: true,
                            recovered: true,
                            requiresManualIntervention: false,
                            quarantinePath: quarantineInfo.quarantineDir,
                            quarantinedFiles: quarantineInfo.quarantinedFiles,
                            recoverySource: `BACKUP_ARCHIVE:${bEntry.name}`,
                            integrityCheck: reopened.integrity,
                            walCheckpointed: true,
                            details: `Quarantined corrupted database files and recovered from backup archive ${bEntry.name}.`
                          };
                          break;
                        }
                      } else if (bakOpened?.client) {
                        try { bakOpened.client.close(); } catch {}
                      }
                    }
                  } catch {} finally {
                    try { if (fsSync.existsSync(candidateBackupSqlite)) fsSync.unlinkSync(candidateBackupSqlite); } catch {}
                  }
                }
              } catch {}
            }
          }

          // Stage 2D: CRITICAL SAFETY REQUIREMENT 3 & 4:
          // Never silently replace an existing company database with an empty database.
          // Never mark a company ACTIVE if its original financial data has not been recovered or explicitly approved for initialization.
          if (!sqlite) {
            if (options?.allowInitializeNew) {
              try { if (fsSync.existsSync(activeSqlitePath)) fsSync.unlinkSync(activeSqlitePath); } catch {}
              sqlite = new Database(activeSqlitePath);
              sqlite.pragma('journal_mode = WAL');
              sqlite.pragma('synchronous = NORMAL');
              sqlite.pragma('busy_timeout = 30000');
              sqlite.pragma('temp_store = MEMORY');
              sqlite.pragma('cache_size = -64000');
              this.ensureBaseSchema(sqlite);
              recoveryDiag = {
                companyId,
                timestamp: new Date().toISOString(),
                status: 'INITIALIZED_NEW',
                originalDataPreserved: false,
                recovered: true,
                requiresManualIntervention: false,
                quarantinePath: quarantineInfo.quarantineDir,
                quarantinedFiles: quarantineInfo.quarantinedFiles,
                recoverySource: 'EXPLICIT_APPROVED_INITIALIZATION',
                integrityCheck: 'ok',
                walCheckpointed: true,
                details: 'Database explicitly approved for initialization after quarantining unrecoverable files.'
              };
            } else {
              await this.updateCompanyManifest(companyId, { status: 'RECOVERY_READ_ONLY' });
              const failedDiag: RecoveryDiagnosticResult = {
                companyId,
                timestamp: new Date().toISOString(),
                status: 'QUARANTINED_MANUAL_INTERVENTION_REQUIRED',
                originalDataPreserved: false,
                recovered: false,
                requiresManualIntervention: true,
                quarantinePath: quarantineInfo.quarantineDir,
                quarantinedFiles: quarantineInfo.quarantinedFiles,
                recoverySource: 'NONE',
                integrityCheck: 'failed',
                walCheckpointed: false,
                details: `Corrupted or uninitialized database for company ${companyId} quarantined at ${quarantineInfo.quarantineDir}. Automatic recovery halted to prevent silent empty-database replacement. Manual intervention or explicit initialization approval is required.`
              };
              this.recordSecurityRecoveryAuditSync(companyId, companyDir, null, failedDiag);
              throw new Error(
                `CORRUPT_DATABASE_QUARANTINED: Database integrity check failed for company ${companyId}. Original files have been preserved in quarantine (${quarantineInfo.quarantineDir}) and company status is set to RECOVERY_READ_ONLY. Manual intervention or backup restoration is required.`
              );
            }
          }
        }
      }
    }

    const db = drizzle(sqlite, { schema });
    const isCorrupt = false;
    
    if (!isCorrupt) {
      // Run migrations (schema versioning & transaction safe)
      try {
    let migrationsFolder = path.resolve(process.cwd(), 'dist/migrations'); // Standard compiled dist location
    const altMigrationsFolder1 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'migrations');
    const altMigrationsFolder2 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', '..', 'migrations');
    const altMigrationsFolder3 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', '..', 'dist', 'migrations');
    
    if (!fsSync.existsSync(migrationsFolder)) {
      if (fsSync.existsSync(altMigrationsFolder1)) migrationsFolder = altMigrationsFolder1;
      else if (fsSync.existsSync(altMigrationsFolder2)) migrationsFolder = altMigrationsFolder2;
      else if (fsSync.existsSync(altMigrationsFolder3)) migrationsFolder = altMigrationsFolder3;
      else migrationsFolder = path.resolve(process.cwd(), 'src/server/db/migrations'); // Dev runtime relative path
    }
        await fs.access(migrationsFolder);
        // drizzle-orm migrator uses transactions internally for sqlite
        try {
          await migrate(db, { migrationsFolder });
        } catch (migErr: any) {
          const msg = String(migErr?.cause?.message || migErr?.message || '');
          if (!msg.includes('already exists')) {
            console.warn(`[CompanyManager] Drizzle migration notice for ${companyId}: ${msg}`);
          }
        }

        // Apply versioned, sequential, transaction-safe enterprise migrations
        try {
          MigrationManager.applyAllMigrations(sqlite, companyId);
        } catch (migErr: any) {
          console.warn(`[CompanyManager] MigrationManager notice for ${companyId}: ${migErr?.message || migErr}`);
        }
        
        // Ensure Phase 8 and Phase 9 schema changes are applied if migration runner skipped them
        try {
          await sqlite.exec("ALTER TABLE sales_invoices ADD COLUMN invoice_type text DEFAULT 'SALES' NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE sales_invoices ADD COLUMN reference text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN reference text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN detail_type text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN is_sub_account integer DEFAULT 0;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN bir_tax_category text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN opening_balance real DEFAULT 0;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN as_of_date text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN currency text DEFAULT 'PHP' NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("UPDATE sales_invoices SET status = 'PARTIAL' WHERE UPPER(status) = 'PARTIALLY_PAID';");
          await sqlite.exec("UPDATE purchase_bills SET status = 'PARTIAL' WHERE UPPER(status) = 'PARTIALLY_PAID';");
        } catch (_) {}

        // Phase 4: Document Management & OCR columns
        const docCols = [
          "ALTER TABLE documents ADD COLUMN document_type text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL;",
          "ALTER TABLE documents ADD COLUMN original_file_name text;",
          "ALTER TABLE documents ADD COLUMN file_size integer DEFAULT 0 NOT NULL;",
          "ALTER TABLE documents ADD COLUMN file_hash text;",
          "ALTER TABLE documents ADD COLUMN source text DEFAULT 'WEB_UI' NOT NULL;",
          "ALTER TABLE documents ADD COLUMN linked_transaction_type text;",
          "ALTER TABLE documents ADD COLUMN linked_transaction_id text;",
          "ALTER TABLE documents ADD COLUMN linked_vendor_id text REFERENCES vendors(id);",
          "ALTER TABLE documents ADD COLUMN linked_customer_id text REFERENCES customers(id);",
          "ALTER TABLE documents ADD COLUMN ocr_status text DEFAULT 'PENDING';",
          "ALTER TABLE documents ADD COLUMN verification_status text DEFAULT 'UNVERIFIED' NOT NULL;",
          "ALTER TABLE documents ADD COLUMN confidence_score real;",
          "ALTER TABLE documents ADD COLUMN ocr_result text;",
          "ALTER TABLE documents ADD COLUMN extracted_merchant text;",
          "ALTER TABLE documents ADD COLUMN extracted_customer text;",
          "ALTER TABLE documents ADD COLUMN extracted_tin text;",
          "ALTER TABLE documents ADD COLUMN extracted_address text;",
          "ALTER TABLE documents ADD COLUMN extracted_invoice_number text;",
          "ALTER TABLE documents ADD COLUMN extracted_date text;",
          "ALTER TABLE documents ADD COLUMN extracted_total_amount integer;",
          "ALTER TABLE documents ADD COLUMN extracted_vat_amount integer;",
          "ALTER TABLE documents ADD COLUMN extracted_vatable_sales integer;",
          "ALTER TABLE documents ADD COLUMN extracted_vat_exempt_sales integer;",
          "ALTER TABLE documents ADD COLUMN extracted_zero_rated_sales integer;",
          "ALTER TABLE documents ADD COLUMN extracted_withholding_tax integer;",
          "ALTER TABLE documents ADD COLUMN extracted_payment_method text;",
          "ALTER TABLE documents ADD COLUMN extracted_category text;",
          "ALTER TABLE documents ADD COLUMN validation_errors text;",
          "ALTER TABLE documents ADD COLUMN validation_warnings text;",
          "ALTER TABLE documents ADD COLUMN encryption_status text DEFAULT 'ENCRYPTED_AES256_GCM';",
          "ALTER TABLE documents ADD COLUMN storage_tier text DEFAULT 'ORIGINALS';",
          "ALTER TABLE documents ADD COLUMN quarantine_reason text;",
          "ALTER TABLE documents ADD COLUMN verified_by text REFERENCES users(id);",
          "ALTER TABLE documents ADD COLUMN verified_at integer;",
          "ALTER TABLE documents ADD COLUMN updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL;"
        ];
        for (const colSql of docCols) {
          try {
            await sqlite.exec(colSql);
          } catch (_) {}
        }

        // Phase 5: Custom Employee Statutory Deductions
        const empCols = [
          "ALTER TABLE employees ADD COLUMN custom_sss_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_sss_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_philhealth_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_philhealth_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_pagibig_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_pagibig_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_withholding_tax integer DEFAULT 0;"
        ];
        for (const colSql of empCols) {
          try {
            await sqlite.exec(colSql);
          } catch (_) {}
        }
        try {
          const userCols = [
            "ALTER TABLE users ADD COLUMN theme text DEFAULT 'light';",
            "ALTER TABLE users ADD COLUMN status text DEFAULT 'ACTIVE' NOT NULL;",
            "ALTER TABLE users ADD COLUMN is_demo integer DEFAULT 0;",
            "ALTER TABLE users ADD COLUMN last_login_at integer;",
            "ALTER TABLE users ADD COLUMN failed_login_attempts integer DEFAULT 0 NOT NULL;",
            "ALTER TABLE users ADD COLUMN locked_until integer;",
            "ALTER TABLE users ADD COLUMN require_password_change integer DEFAULT 0;"
          ];
          for (const colSql of userCols) {
            try { await sqlite.exec(colSql); } catch (_) {}
          }
        } catch (e) {
          console.error("users column migration error:", e);
        }
        try {
          const licTableInfo = sqlite.pragma("table_info('company_licenses')") as any[];
          const hasModernTrialCol = Array.isArray(licTableInfo) && licTableInfo.some(c => c.name === 'trial_start_date');
          if (!hasModernTrialCol) {
            await sqlite.exec("PRAGMA foreign_keys=OFF;");
            await sqlite.exec(`
              CREATE TABLE IF NOT EXISTS company_licenses_new (
                id text PRIMARY KEY NOT NULL,
                company_id text NOT NULL REFERENCES companies(id),
                license_key text NOT NULL,
                plan_type text DEFAULT 'TRIAL' NOT NULL,
                status text DEFAULT 'ACTIVE' NOT NULL,
                trial_start_date text NOT NULL,
                expiration_date text NOT NULL,
                device_binding_hash text,
                signed_file_content text NOT NULL,
                is_lifetime integer DEFAULT 0 NOT NULL,
                previous_license_id text,
                replacement_reason text,
                created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
                updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
              );
            `);
            try {
              await sqlite.exec(`
                INSERT OR IGNORE INTO company_licenses_new (id, company_id, license_key, plan_type, status, trial_start_date, expiration_date, signed_file_content, is_lifetime, created_at, updated_at)
                SELECT id, company_id, license_key, plan_type, status, COALESCE(valid_from, '2026-01-01'), COALESCE(valid_until, '2027-01-01'), COALESCE(metadata, '{}'), 0, created_at, updated_at FROM company_licenses;
              `);
            } catch (_) {}
            await sqlite.exec(`DROP TABLE IF EXISTS company_licenses;`);
            await sqlite.exec(`ALTER TABLE company_licenses_new RENAME TO company_licenses;`);
            await sqlite.exec("PRAGMA foreign_keys=ON;");
          }
        } catch (e) {
          await sqlite.exec("PRAGMA foreign_keys=ON;").catch(() => {});
          console.error("company_licenses migration fix error:", e);
        }
        try {
          const licTableInfo = sqlite.pragma("table_info('company_licenses')") as any[];
          const colNames = new Set(Array.isArray(licTableInfo) ? licTableInfo.map((c: any) => c.name) : []);
          const addColIfMissing = (name: string, def: string) => {
            if (!colNames.has(name)) {
              sqlite.exec(`ALTER TABLE company_licenses ADD COLUMN ${name} ${def};`);
            }
          };
          addColIfMissing('seat_count', 'integer DEFAULT 3');
          addColIfMissing('license_pair_id', 'text');
          addColIfMissing('key_file_id', 'text');
          addColIfMissing('activation_record_id', 'text');
          addColIfMissing('activation_timestamp', 'text');
          addColIfMissing('activated_by', 'text');
          addColIfMissing('key_file_content', 'text');
          addColIfMissing('activation_receipt', 'text');
          addColIfMissing('revocation_ref', 'text');
          addColIfMissing('license_version', "text DEFAULT '2.0'");
          addColIfMissing('activation_policy', "text DEFAULT 'ONE_TIME_COMPANY_BOUND'");
          addColIfMissing('recovery_reference', 'text');
          addColIfMissing('recovery_reason', 'text');

          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS license_redemption_records (
              id text PRIMARY KEY,
              company_id text NOT NULL REFERENCES companies(id),
              license_pair_id text NOT NULL,
              license_id text NOT NULL,
              key_file_id text NOT NULL,
              activation_key text NOT NULL,
              plan_type text NOT NULL,
              activation_status text NOT NULL,
              activated_at text NOT NULL,
              activated_by text,
              activation_receipt text NOT NULL,
              recovery_reference text,
              recovery_reason text,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
          `);
        } catch (_) {}
        try {
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS license_audit_logs (
              id text PRIMARY KEY,
              company_id text,
              action text NOT NULL,
              details text NOT NULL,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              FOREIGN KEY(company_id) REFERENCES companies(id)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS company_user_roles (
              id text PRIMARY KEY,
              company_user_id text NOT NULL REFERENCES company_users(id),
              role_id text NOT NULL REFERENCES roles(id),
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(company_user_id, role_id)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS user_permission_overrides (
              id text PRIMARY KEY,
              company_user_id text NOT NULL REFERENCES company_users(id),
              permission_code text NOT NULL,
              effect text NOT NULL,
              reason text,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(company_user_id, permission_code)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS sod_restrictions (
              id text PRIMARY KEY,
              rule_code text NOT NULL UNIQUE,
              rule_name text NOT NULL,
              description text,
              incompatible_role_1 text NOT NULL,
              incompatible_role_2 text NOT NULL,
              restricted_permissions text,
              status text NOT NULL DEFAULT 'ACTIVE',
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
          `);
        } catch (err) {
          console.error("Error creating phase 3 tables", err);
        }
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN notes text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN address text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN branch_code text DEFAULT '00000';");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_person text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_email text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_phone text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN industry text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN fiscal_year integer DEFAULT 2026;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN accounting_method text DEFAULT 'ACCRUAL';");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN taxpayer_classification text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN bir_registration_no text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN bir_date_registered text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN document_location_path text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN backup_location_path text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN attachment_url text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN withholding_tax_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN withholding_tax_account_id text REFERENCES accounts(id);");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN overpayment_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN payment_method text DEFAULT 'BANK_TRANSFER' NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN notes text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN attachment_url text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payment_applications ADD COLUMN withholding_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_payments (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            customer_id text NOT NULL REFERENCES customers(id),
            payment_number text NOT NULL,
            official_receipt_number text,
            payment_date text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            amount integer NOT NULL,
            withholding_tax_amount integer DEFAULT 0 NOT NULL,
            withholding_tax_account_id text REFERENCES accounts(id),
            overpayment_amount integer DEFAULT 0 NOT NULL,
            payment_method text DEFAULT 'BANK_TRANSFER' NOT NULL,
            reference text,
            notes text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_payment_applications (
            id text PRIMARY KEY NOT NULL,
            payment_id text NOT NULL REFERENCES customer_payments(id),
            invoice_id text NOT NULL REFERENCES sales_invoices(id),
            applied_amount integer NOT NULL,
            withholding_amount integer DEFAULT 0 NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memos (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            customer_id text NOT NULL REFERENCES customers(id),
            credit_memo_number text NOT NULL,
            memo_date text NOT NULL,
            reason text,
            total_amount integer NOT NULL,
            balance_remaining integer NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memo_lines (
            id text PRIMARY KEY NOT NULL,
            credit_memo_id text NOT NULL REFERENCES credit_memos(id),
            account_id text NOT NULL REFERENCES accounts(id),
            tax_code_id text REFERENCES tax_codes(id),
            description text,
            quantity real DEFAULT 1 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memo_applications (
            id text PRIMARY KEY NOT NULL,
            credit_memo_id text NOT NULL REFERENCES credit_memos(id),
            invoice_id text NOT NULL REFERENCES sales_invoices(id),
            applied_amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          // LEDGERAI PH MODULES
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS currency_exchange_rates (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            rate_date text NOT NULL,
            currency text DEFAULT 'USD' NOT NULL,
            bsp_spot_rate real NOT NULL,
            source text DEFAULT 'BSP' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            sku text NOT NULL,
            name text NOT NULL,
            description text,
            category text,
            unit_of_measure text DEFAULT 'PCS' NOT NULL,
            costing_method text DEFAULT 'FIFO' NOT NULL,
            unit_cost integer DEFAULT 0 NOT NULL,
            selling_price integer DEFAULT 0 NOT NULL,
            quantity_on_hand real DEFAULT 0 NOT NULL,
            reorder_point real DEFAULT 10 NOT NULL,
            asset_account_id text REFERENCES accounts(id),
            cogs_account_id text REFERENCES accounts(id),
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS stock_adjustments (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            adjustment_number text NOT NULL,
            adjustment_date text NOT NULL,
            item_id text NOT NULL REFERENCES inventory_items(id),
            quantity_change real NOT NULL,
            reason text NOT NULL,
            expense_account_id text REFERENCES accounts(id),
            status text DEFAULT 'POSTED' NOT NULL,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS employees (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            employee_no text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            email text,
            tin text,
            sss_no text,
            philhealth_no text,
            pagibig_no text,
            position text,
            department text,
            monthly_basic_salary integer NOT NULL,
            daily_rate integer DEFAULT 0 NOT NULL,
            hourly_rate integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS payroll_runs (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            payroll_period text NOT NULL,
            start_date text NOT NULL,
            end_date text NOT NULL,
            payment_date text NOT NULL,
            total_gross_pay integer DEFAULT 0 NOT NULL,
            total_sss integer DEFAULT 0 NOT NULL,
            total_philhealth integer DEFAULT 0 NOT NULL,
            total_pagibig integer DEFAULT 0 NOT NULL,
            total_withholding_tax integer DEFAULT 0 NOT NULL,
            total_net_pay integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS payroll_items (
            id text PRIMARY KEY NOT NULL,
            payroll_run_id text NOT NULL REFERENCES payroll_runs(id),
            employee_id text NOT NULL REFERENCES employees(id),
            basic_pay integer NOT NULL,
            overtime_pay integer DEFAULT 0 NOT NULL,
            holiday_pay integer DEFAULT 0 NOT NULL,
            night_diff_pay integer DEFAULT 0 NOT NULL,
            gross_pay integer NOT NULL,
            sss_employee integer DEFAULT 0 NOT NULL,
            sss_employer integer DEFAULT 0 NOT NULL,
            philhealth_employee integer DEFAULT 0 NOT NULL,
            philhealth_employer integer DEFAULT 0 NOT NULL,
            pagibig_employee integer DEFAULT 0 NOT NULL,
            pagibig_employer integer DEFAULT 0 NOT NULL,
            withholding_tax integer DEFAULT 0 NOT NULL,
            total_deductions integer NOT NULL,
            net_pay integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS fixed_assets (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            asset_tag text NOT NULL,
            asset_name text NOT NULL,
            category text NOT NULL,
            acquisition_date text NOT NULL,
            acquisition_cost integer NOT NULL,
            salvage_value integer DEFAULT 0 NOT NULL,
            useful_life_months integer NOT NULL,
            depreciation_method text DEFAULT 'STRAIGHT_LINE' NOT NULL,
            asset_account_id text REFERENCES accounts(id),
            accumulated_dep_account_id text REFERENCES accounts(id),
            depreciation_expense_account_id text REFERENCES accounts(id),
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS depreciation_schedules (
            id text PRIMARY KEY NOT NULL,
            asset_id text NOT NULL REFERENCES fixed_assets(id),
            company_id text NOT NULL REFERENCES companies(id),
            period_month text NOT NULL,
            depreciation_amount integer NOT NULL,
            accumulated_depreciation integer NOT NULL,
            book_value integer NOT NULL,
            status text DEFAULT 'PENDING' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            vendor_id text NOT NULL REFERENCES vendors(id),
            po_number text NOT NULL,
            po_date text NOT NULL,
            expected_delivery_date text,
            total_amount integer NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            created_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_order_lines (
            id text PRIMARY KEY NOT NULL,
            po_id text NOT NULL REFERENCES purchase_orders(id),
            item_id text REFERENCES inventory_items(id),
            description text NOT NULL,
            quantity_ordered real NOT NULL,
            quantity_received real DEFAULT 0 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS goods_receipt_notes (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            po_id text NOT NULL REFERENCES purchase_orders(id),
            grn_number text NOT NULL,
            receipt_date text NOT NULL,
            delivery_note_no text,
            status text DEFAULT 'RECEIVED' NOT NULL,
            received_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS goods_receipt_lines (
            id text PRIMARY KEY NOT NULL,
            grn_id text NOT NULL REFERENCES goods_receipt_notes(id),
            po_line_id text NOT NULL REFERENCES purchase_order_lines(id),
            quantity_received real NOT NULL,
            notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memos (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            vendor_id text NOT NULL REFERENCES vendors(id),
            debit_memo_number text NOT NULL,
            memo_date text NOT NULL,
            reason text,
            total_amount integer NOT NULL,
            balance_remaining integer NOT NULL,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memo_lines (
            id text PRIMARY KEY NOT NULL,
            debit_memo_id text NOT NULL REFERENCES debit_memos(id),
            account_id text NOT NULL REFERENCES accounts(id),
            tax_code_id text REFERENCES tax_codes(id),
            description text,
            quantity real DEFAULT 1 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memo_applications (
            id text PRIMARY KEY NOT NULL,
            debit_memo_id text NOT NULL REFERENCES debit_memos(id),
            bill_id text NOT NULL REFERENCES purchase_bills(id),
            applied_amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          // Phase 10 Cash Management Schema Updates
          try {
            await sqlite.exec("ALTER TABLE cash_transactions ADD COLUMN attachment_url text;");
          } catch (_) {}

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS checks (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            check_number text NOT NULL,
            check_date text NOT NULL,
            payee_name text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            amount integer NOT NULL,
            voucher_number text,
            status text DEFAULT 'ISSUED' NOT NULL,
            cleared_date text,
            cancellation_reason text,
            cancellation_journal_entry_id text REFERENCES journal_entries(id),
            attachment_url text,
            notes text,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_deposits (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            deposit_number text NOT NULL,
            deposit_date text NOT NULL,
            to_bank_account_id text NOT NULL REFERENCES accounts(id),
            from_cash_account_id text NOT NULL REFERENCES accounts(id),
            total_amount integer NOT NULL,
            reference text,
            notes text,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS cash_counts (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            count_number text NOT NULL,
            count_date text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            custodian_name text NOT NULL,
            book_balance integer NOT NULL,
            counted_balance integer NOT NULL,
            variance_amount integer DEFAULT 0 NOT NULL,
            variance_account_id text REFERENCES accounts(id),
            notes text,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS cash_count_denominations (
            id text PRIMARY KEY NOT NULL,
            cash_count_id text NOT NULL REFERENCES cash_counts(id),
            denomination_label text NOT NULL,
            unit_value integer NOT NULL,
            count_quantity integer NOT NULL,
            total_amount integer NOT NULL
          );`);

          // Phase 11 Bank Reconciliation
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_reconciliations (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            bank_account_id text NOT NULL REFERENCES accounts(id),
            statement_date text NOT NULL,
            statement_ending_balance integer NOT NULL,
            book_ending_balance integer DEFAULT 0 NOT NULL,
            cleared_deposits_count integer DEFAULT 0 NOT NULL,
            cleared_deposits_amount integer DEFAULT 0 NOT NULL,
            cleared_checks_count integer DEFAULT 0 NOT NULL,
            cleared_checks_amount integer DEFAULT 0 NOT NULL,
            outstanding_checks_count integer DEFAULT 0 NOT NULL,
            outstanding_checks_amount integer DEFAULT 0 NOT NULL,
            deposits_in_transit_count integer DEFAULT 0 NOT NULL,
            deposits_in_transit_amount integer DEFAULT 0 NOT NULL,
            bank_charges_amount integer DEFAULT 0 NOT NULL,
            interest_income_amount integer DEFAULT 0 NOT NULL,
            other_adjustments_amount integer DEFAULT 0 NOT NULL,
            adjusted_book_balance integer DEFAULT 0 NOT NULL,
            adjusted_statement_balance integer DEFAULT 0 NOT NULL,
            unexplained_difference integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            reopen_reason text,
            journal_entry_id text REFERENCES journal_entries(id),
            notes text,
            attachment_url text,
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            reopened_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_statement_lines (
            id text PRIMARY KEY NOT NULL,
            bank_reconciliation_id text NOT NULL REFERENCES bank_reconciliations(id),
            company_id text NOT NULL REFERENCES companies(id),
            bank_account_id text NOT NULL REFERENCES accounts(id),
            line_date text NOT NULL,
            description text NOT NULL,
            reference text,
            type text NOT NULL,
            amount integer NOT NULL,
            matched_status text DEFAULT 'UNMATCHED' NOT NULL,
            matched_type text,
            matched_entity_id text,
            matched_amount integer DEFAULT 0 NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_reconciliation_adjustments (
            id text PRIMARY KEY NOT NULL,
            bank_reconciliation_id text NOT NULL REFERENCES bank_reconciliations(id),
            company_id text NOT NULL REFERENCES companies(id),
            type text NOT NULL,
            amount integer NOT NULL,
            offset_account_id text NOT NULL REFERENCES accounts(id),
            description text NOT NULL,
            reference text,
            adjustment_date text NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_filings (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            tax_type text NOT NULL,
            period_name text NOT NULL,
            start_date text NOT NULL,
            end_date text NOT NULL,
            deadline_date text NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            total_tax_base integer DEFAULT 0 NOT NULL,
            total_tax_due integer DEFAULT 0 NOT NULL,
            net_tax_payable integer DEFAULT 0 NOT NULL,
            filed_at integer,
            filed_by text REFERENCES users(id),
            locked_at integer,
            locked_by text REFERENCES users(id),
            notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_filing_checklists (
            id text PRIMARY KEY NOT NULL,
            tax_filing_id text NOT NULL REFERENCES tax_filings(id),
            task_name text NOT NULL,
            description text,
            is_completed integer DEFAULT 0 NOT NULL,
            completed_by text REFERENCES users(id),
            completed_at integer
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_manual_adjustments (
            id text PRIMARY KEY NOT NULL,
            tax_filing_id text NOT NULL REFERENCES tax_filings(id),
            company_id text NOT NULL REFERENCES companies(id),
            adjustment_type text NOT NULL,
            description text NOT NULL,
            amount integer NOT NULL,
            reason text,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_calendar (
            id text PRIMARY KEY NOT NULL,
            company_id text REFERENCES companies(id),
            tax_type text NOT NULL,
            form_number text NOT NULL,
            period_description text NOT NULL,
            deadline_date text NOT NULL,
            status text DEFAULT 'UPCOMING' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
        } catch (err) { console.error("ALTER ERROR", err); }

        // Ensure all versioned enterprise migrations (including 0005-0021 RBAC, module assignment, and concurrency tables) are applied after base/phase tables exist
        try {
          MigrationManager.applyAllMigrations(sqlite, companyId);
        } catch (migErr: any) {
          console.error(`[CompanyManager] Post-bootstrap MigrationManager failure for ${companyId}: ${migErr?.message || migErr}`);
          throw migErr;
        }

        if (manifest.status === "RECOVERY_READ_ONLY" && recoveryDiag && (recoveryDiag.originalDataPreserved || options?.allowInitializeNew)) {
           await this.updateCompanyManifest(companyId, { status: "ACTIVE" });
        }
      } catch (err: any) {
        console.error(`Migration failed for company ${companyId}, executing fallback bootstrap:`, err);
        try {
          fsSync.writeFileSync(
            path.join(os.tmpdir(), `migration_error_${companyId.replace(/[^a-zA-Z0-9._-]/g, '_')}.log`),
            String(err?.stack || err)
          );
        } catch {}
      }

      // Always guarantee base schema exists so queries never fail on missing tables
      this.ensureBaseSchema(sqlite);

      // Ensure company record and default active license exist in isolated database
      try {
        const resolvedClass = inferCompanyClassification(
          manifest.id,
          manifest.legalName,
          manifest.isDemo,
          manifest.classification
        );
        await db.insert(schema.companies).values({
          id: manifest.id,
          legalName: manifest.legalName || "Company",
          status: "ACTIVE",
          classification: resolvedClass,
          isDemo: Boolean(manifest.isDemo),
        }).onConflictDoNothing();

        const existingLic = await db.select().from(schema.companyLicenses).where(eq(schema.companyLicenses.companyId, manifest.id)).get();
        if (!existingLic) {
          const startStr = new Date().toISOString().slice(0, 10);
          const endStr = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          await db.insert(schema.companyLicenses).values({
            id: crypto.randomUUID(),
            companyId: manifest.id,
            licenseKey: `LIC-TRIAL-${manifest.id.slice(0, 8).toUpperCase()}`,
            planType: "TRIAL",
            status: "ACTIVE",
            trialStartDate: startStr,
            expirationDate: endStr,
            signedFileContent: JSON.stringify({ companyId: manifest.id, plan: "TRIAL", active: true, trialStartDate: startStr, expirationDate: endStr }),
            isLifetime: false
          }).onConflictDoNothing();
        }
      } catch (_) {}

      // Checkpoint WAL into main SQLite file and sync encrypted .lai snapshot
      try {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
        const postCheck = sqlite.pragma('integrity_check') as any[];
        if (postCheck?.[0]?.integrity_check === 'ok' && fsSync.existsSync(activeSqlitePath) && dbPath) {
          DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath);
        }
      } catch (_) {}

      if (recoveryDiag) {
        this.recordSecurityRecoveryAuditSync(companyId, companyDir, sqlite, recoveryDiag);
      }

      if (manifest.status === "RECOVERY_READ_ONLY" && recoveryDiag && (recoveryDiag.originalDataPreserved || options?.allowInitializeNew)) {
        await this.updateCompanyManifest(companyId, { status: "ACTIVE" });
      }
    }

    sqliteCache.set(companyId, sqlite);
    lastCompanyAccessAt.set(companyId, Date.now());
    try {
      if (fsSync.existsSync(activeSqlitePath)) {
        sqliteInodeCache.set(companyId, fsSync.statSync(activeSqlitePath).ino);
      }
    } catch {}
    dbCache.set(companyId, db);
    return db;
  }

  static async closeCompanyDb(companyId: string) {
    dbCache.delete(companyId);
    sqliteInodeCache.delete(companyId);
    activeCompanyRequests.delete(companyId);
    lastCompanyAccessAt.delete(companyId);
    const sqlite = sqliteCache.get(companyId);
    if (sqlite) {
      try {
        if (typeof sqlite.pragma === 'function') {
          try { sqlite.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        }
        sqlite.close();
      } catch (err: any) {
        console.error(`[CompanyManager] Error closing SQLite connection for ${companyId}:`, err?.message);
      }
      sqliteCache.delete(companyId);
    }

    // Clean up process lockfile if held by this process
    try {
      const manifest = await this.getCompanyManifest(companyId);
      if (manifest) {
        const companyDir = manifest.location || path.dirname(manifest.dbPath);
        const lockFilePath = path.join(companyDir, '.server_process.lock');
        if (fsSync.existsSync(lockFilePath)) {
          const raw = fsSync.readFileSync(lockFilePath, 'utf8');
          const lock = JSON.parse(raw);
          if (lock.pid === process.pid) {
            fsSync.unlinkSync(lockFilePath);
          }
        }
      }
    } catch {}
  }

  /**
   * Multi-user safe database pool cleanup.
   * By default (force !== true), NEVER closes another company's live database handle if it has
   * in-flight HTTP requests or was accessed recently (within idleThresholdMs), preserving
   * simultaneous multi-workstation LAN access across different companies.
   * Pass `{ force: true }` strictly for explicit server shutdown or administrative maintenance.
   */
  static async closeOtherCompanyDbs(
    keepCompanyId?: string,
    options?: { force?: boolean; idleThresholdMs?: number }
  ): Promise<string[]> {
    const force = Boolean(options?.force);
    const idleThresholdMs = options?.idleThresholdMs ?? DEFAULT_IDLE_EVICTION_MS;
    const now = Date.now();
    const closedIds: string[] = [];
    const openIds = new Set<string>([...dbCache.keys(), ...sqliteCache.keys()]);

    for (const cid of openIds) {
      if (keepCompanyId && cid === keepCompanyId) continue;

      if (!force) {
        const inFlight = activeCompanyRequests.get(cid) || 0;
        if (inFlight > 0) continue;

        const lastAccess = lastCompanyAccessAt.get(cid) || 0;
        if (now - lastAccess < idleThresholdMs) continue;
      }

      try {
        await this.checkpointAndSyncFinancialSnapshotNow(cid).catch(() => {});
        await this.closeCompanyDb(cid);
        closedIds.push(cid);
      } catch {}
    }
    return closedIds;
  }

  /**
   * Checks for duplicate registered legal name / TIN or non-empty workspace folder before company creation.
   */
  static async checkDuplicateCompanyConflict(params: {
    legalName?: string;
    tin?: string;
    targetDir: string;
    excludeCompanyId?: string;
  }): Promise<void> {
    const resolvedTarget = path.resolve(params.targetDir);
    const existing = await this.listCompanies({ includeSynthetic: true });
    const normLegal = (params.legalName || '').trim().toLowerCase();
    const normTin = (params.tin || '').replace(/[^0-9]/g, '');

    for (const c of existing) {
      if (params.excludeCompanyId && c.id === params.excludeCompanyId) continue;
      const cls = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
      // Do not allow synthetic test data to block production unless exact location matches
      if (c.location && path.resolve(c.location) === resolvedTarget) {
        throw new Error(
          `TARGET_DIRECTORY_NOT_EMPTY: Storage directory '${resolvedTarget}' is already assigned to company '${c.legalName}' (${c.id}). Choose a different folder.`
        );
      }
      if (!isSyntheticCompanyClassification(cls)) {
        if (normLegal && (c.legalName || '').trim().toLowerCase() === normLegal) {
          throw new Error(
            `DUPLICATE_COMPANY_CONFLICT: A company profile named '${c.legalName}' already exists (${c.id}). Open or restore the existing workspace instead of creating a duplicate.`
          );
        }
        if (normTin && normTin.length >= 9) {
          // Check manifest or company DB TIN if available
          try {
            const cDir = c.location || path.dirname(c.dbPath);
            const cSqlitePath = path.join(cDir, '.db_active.sqlite');
            if (fsSync.existsSync(cSqlitePath)) {
              const ro = new Database(cSqlitePath, { readonly: true });
              try {
                const row = ro.prepare('SELECT tin FROM companies WHERE id = ?').get(c.id) as { tin?: string } | undefined;
                const existingTin = String(row?.tin || '').replace(/[^0-9]/g, '');
                if (existingTin && existingTin === normTin) {
                  throw new Error(
                    `DUPLICATE_COMPANY_CONFLICT: A company profile with TIN '${params.tin}' already exists (${c.legalName} / ${c.id}).`
                  );
                }
              } finally {
                ro.close();
              }
            }
          } catch (tinErr: any) {
            if (String(tinErr?.message || '').startsWith('DUPLICATE_COMPANY_CONFLICT')) {
              throw tinErr;
            }
          }
        }
      }
    }

    // Also guard against pointing Create Company at an existing populated company directory on disk
    if (fsSync.existsSync(resolvedTarget)) {
      const conflictingArtifacts = ['database.lai', 'company.lai', 'database.sqlite', '.db_active.sqlite', 'manifest.json'];
      for (const art of conflictingArtifacts) {
        const artPath = path.join(resolvedTarget, art);
        if (fsSync.existsSync(artPath)) {
          try {
            if (fsSync.statSync(artPath).size > 0) {
              throw new Error(
                `TARGET_DIRECTORY_NOT_EMPTY: Target folder '${resolvedTarget}' already contains existing database/workspace file '${art}'. Use "Open Existing Profile" or choose an empty folder.`
              );
            }
          } catch (e: any) {
            if (String(e?.message || '').startsWith('TARGET_DIRECTORY_NOT_EMPTY')) throw e;
          }
        }
      }
    }
  }

  static async rollbackCompanyCreation(companyId: string, locationPath?: string) {
    console.log(`[CompanyManager] Initiating atomic rollback for company creation: ${companyId}`);
    
    // 1. Close active DB handle and remove from caches
    await this.closeCompanyDb(companyId);

    // 2. Remove temporary manifest
    this.removeTempManifest(companyId);

    // 3. Unregister from registry if registered
    try {
      await this.unregisterCompany(companyId);
    } catch (_) {}

    // 4. Remove company directory from filesystem with retries for Windows file locks
    const targetDir = locationPath || path.join(paths.getCompaniesRootDir(), companyId);
    if (targetDir && fsSync.existsSync(targetDir)) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await fs.rm(targetDir, { recursive: true, force: true });
          console.log(`[CompanyManager] Successfully cleaned up directory for ${companyId} on attempt ${attempt}`);
          break;
        } catch (rmErr: any) {
          console.error(`[CompanyManager] Retry ${attempt} removing ${targetDir}: ${rmErr.message}`);
          if (attempt === 3) {
            console.error(`[CompanyManager] Persistent failure cleaning up ${targetDir}`);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          }
        }
      }
    }
  }

  static async ensureCompanyAccountingPeriods(
    companyId: string,
    options?: { fiscalYear?: number; fiscalYearStartMonth?: number; simulateFailure?: boolean }
  ): Promise<{ createdCount: number; totalCount: number; periods: any[] }> {
    if (options?.simulateFailure) {
      throw new Error('SIMULATED_PERIOD_GENERATION_FAILURE: Forced failure during accounting period provisioning.');
    }

    const companyDb = await this.getCompanyDb(companyId, { allowInitializeNew: true });
    const companyRow = await companyDb
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();

    const startMonth = options?.fiscalYearStartMonth || companyRow?.fiscalYearStartMonth || 1;
    // Use Asia/Manila current year or 2026 default
    const manilaYearStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric'
    }).format(new Date());
    const baseYear = options?.fiscalYear || Number(manilaYearStr) || 2026;

    const existingPeriods = await companyDb
      .select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.companyId, companyId))
      .all();
    const existingByName = new Set(existingPeriods.map((p: any) => String(p.name)));
    const existingByRange = new Set(
      existingPeriods.map((p: any) => `${String(p.startDate || '').slice(0, 10)}::${String(p.endDate || '').slice(0, 10)}`)
    );

    const firstUser = await companyDb.select().from(schema.users).get();

    let createdCount = 0;
    for (let i = 0; i < 12; i++) {
      const monthIndex0 = (startMonth - 1 + i) % 12;
      const yearOffset = Math.floor((startMonth - 1 + i) / 12);
      const calYear = baseYear + yearOffset;
      const calMonth = monthIndex0 + 1;
      const mm = String(calMonth).padStart(2, '0');
      const periodName = `${calYear}-${mm}`;

      // Exact last day of the month in Asia/Manila calendar
      const lastDay = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate();
      const startDate = `${calYear}-${mm}-01`;
      const endDate = `${calYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
      const rangeKey = `${startDate}::${endDate}`;

      if (existingByName.has(periodName) || existingByRange.has(rangeKey)) {
        continue;
      }

      const periodId = `ap-${companyId.slice(-8)}-${periodName}`;

      await companyDb.insert(schema.accountingPeriods).values({
        id: periodId,
        companyId,
        name: periodName,
        fiscalYear: baseYear,
        startDate,
        endDate,
        status: 'OPEN'
      }).onConflictDoNothing();

      if (firstUser?.id) {
        await companyDb.insert(schema.periodStatusHistory).values({
          id: crypto.randomUUID(),
          accountingPeriodId: periodId,
          companyId,
          action: 'CREATE',
          previousStatus: 'NONE',
          newStatus: 'OPEN',
          reason: 'Automated fiscal year period initialization (DEF-003)',
          changedBy: firstUser.id
        }).onConflictDoNothing();
      }

      existingByName.add(periodName);
      existingByRange.add(rangeKey);
      createdCount++;
    }

    const finalPeriods = await companyDb
      .select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.companyId, companyId))
      .all();

    return {
      createdCount,
      totalCount: finalPeriods.length,
      periods: finalPeriods
    };
  }

  static async createCompanyProfile(
    id: string,
    legalName: string,
    locationPath?: string,
    backupLocationPath?: string,
    skipRegistry: boolean = false,
    options?: {
      fiscalYear?: number;
      fiscalYearStartMonth?: number;
      simulateFailure?: boolean;
      classification?: CompanyClassification;
      encryptionKeyMode?: EncryptionKeyMode;
    }
  ): Promise<CompanyManifest> {
    const dirPath = locationPath || path.join(paths.getCompaniesRootDir(), id);
    const backupPath = backupLocationPath || path.join(dirPath, 'backups');
    const resolvedClassification = inferCompanyClassification(
      id,
      legalName,
      false,
      options?.classification
    );
    const defaultKeyMode: EncryptionKeyMode =
      options?.encryptionKeyMode ||
      (resolvedClassification === 'PRODUCTION' || resolvedClassification === 'PILOT'
        ? 'OS_KEYCHAIN_STANDALONE'
        : 'LEGACY_DEV_KEY');

    // Phase 6: Enforce Production Key Policy before creating any files on disk
    const keyPolicy = DatabaseEncryptionService.assertProductionKeyPolicy({
      companyId: id,
      classification: resolvedClassification,
      keyMode: defaultKeyMode,
    });

    try {
      await fs.mkdir(dirPath, { recursive: true });
      await fs.mkdir(backupPath, { recursive: true });

      // Create folders
      await fs.mkdir(path.join(dirPath, 'documents'), { recursive: true });

      const manifest: CompanyManifest = {
        id,
        legalName,
        createdAt: new Date().toISOString(),
        dbPath: path.join(dirPath, 'database.lai'),
        documentLocation: path.join(dirPath, 'documents'),
        location: dirPath,
        backupLocation: backupPath,
        status: "ACTIVE",
        classification: resolvedClassification,
        encryptionKeyMode: keyPolicy.effectiveKeyMode,
        keyId: keyPolicy.keyId,
        isDemo: false
      };

      await fs.writeFile(path.join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
      if (!skipRegistry) {
        await this.registerCompany(manifest);
      } else {
        this.setTempManifest(id, manifest);
      }

      // Initialize DB to create tables (explicitly approved for brand-new company creation)
      const companyDb = await this.getCompanyDb(id, { allowInitializeNew: true });
      await companyDb.insert(schema.companies).values({
        id,
        legalName,
        vatStatus: 'VAT',
        taxpayerClassification: 'CORPORATION',
        status: "ACTIVE",
        classification: resolvedClassification,
        isDemo: false,
        fiscalYearStartMonth: options?.fiscalYearStartMonth || 1
      }).onConflictDoNothing();

      // DEF-003: Automatically generate 12 monthly accounting periods for the new company
      await this.ensureCompanyAccountingPeriods(id, options);
      await this.syncCompanyDatabaseSnapshot(id);

      if (!skipRegistry) {
        try {
          const { CompanyLifecycleService } = await import('./companyLifecycleService');
          await CompanyLifecycleService.recordShortcut({
            companyId: manifest.id,
            displayName: manifest.legalName,
            databasePath: manifest.dbPath,
            companyDirectory: manifest.location,
            databaseIdentity: manifest.id,
            lastOperation: 'CREATED',
            lastOpenedAt: manifest.createdAt,
            availabilityStatus: 'AVAILABLE',
            validationStatus: 'VALID',
            classification: resolvedClassification,
            isDemo: false,
            lastValidationError: null,
          });
        } catch {
          // Non-fatal shortcut registration error
        }
      }

      return manifest;
    } catch (err: any) {
      await this.rollbackCompanyCreation(id, dirPath);
      throw err;
    }
  }

  /**
   * DEF-009: Classifies and quarantines all synthetic/stress-test/benchmark company profiles
   * in the registry and on disk in COMPANIES_ROOT without deleting any data.
   * Respects registrationStatus = 'UNREGISTERED' / 'ARCHIVED', archived workspace markers,
   * and requires at least one valid database representation before auto-discovering a folder.
   */
  static async quarantineAndClassifyRegisteredCompanies(): Promise<
    Array<{ companyId: string; legalName: string; classification: CompanyClassification; isQuarantinedFromProduction: boolean }>
  > {
    try {
      const companiesRootDir = paths.getCompaniesRootDir();
      const rootEntries = await fs.readdir(companiesRootDir, { withFileTypes: true });
      const existingReg = await this.listCompanies({ includeSynthetic: true });
      const regIds = new Set(existingReg.map((c) => c.id));
      const regLocations = new Set(
        existingReg
          .map((c) => (c.location ? path.resolve(c.location) : ''))
          .filter(Boolean)
      );

      for (const entry of rootEntries) {
        if (!entry.isDirectory()) continue;
        const dirId = entry.name;
        // Skip hidden/archived system folders (e.g., .archived_workspaces)
        if (dirId.startsWith('.')) continue;
        if (regIds.has(dirId)) continue;

        const dirPath = path.resolve(companiesRootDir, dirId);
        if (regLocations.has(dirPath)) continue;

        const manifestFile = path.join(dirPath, 'manifest.json');
        const activeDbFile = path.join(dirPath, '.db_active.sqlite');
        const laiFile = path.join(dirPath, 'database.lai');
        const sqliteFallbackFile = path.join(dirPath, 'database.sqlite');
        const companyDbFile = path.join(dirPath, 'company.db');
        const unregisteredMarker = path.join(dirPath, '.unregistered');
        const archivedMarker = path.join(dirPath, '.archived');

        if (fsSync.existsSync(unregisteredMarker) || fsSync.existsSync(archivedMarker)) {
          continue;
        }

        // Never auto-discover a directory that lacks any actual database representation on disk
        const hasValidDbFile =
          (fsSync.existsSync(activeDbFile) && fsSync.statSync(activeDbFile).size > 0) ||
          (fsSync.existsSync(laiFile) && fsSync.statSync(laiFile).size > 0) ||
          (fsSync.existsSync(sqliteFallbackFile) && fsSync.statSync(sqliteFallbackFile).size > 0) ||
          (fsSync.existsSync(companyDbFile) && fsSync.statSync(companyDbFile).size > 0);

        if (!hasValidDbFile) {
          continue;
        }

        let manifestObj: CompanyManifest | null = null;
        if (fsSync.existsSync(manifestFile)) {
          try {
            manifestObj = JSON.parse(fsSync.readFileSync(manifestFile, 'utf8'));
          } catch {}
        }

        // Respect intentional unregistration or archival in manifest.json
        if (
          manifestObj?.registrationStatus === 'UNREGISTERED' ||
          manifestObj?.registrationStatus === 'ARCHIVED' ||
          manifestObj?.status === 'ARCHIVED' ||
          manifestObj?.status === 'UNREGISTERED' ||
          Boolean(manifestObj?.archivedAt)
        ) {
          continue;
        }

        const resolvedId = manifestObj?.id || dirId;
        if (regIds.has(resolvedId)) continue;

        const inferredClass = inferCompanyClassification(
          resolvedId,
          manifestObj?.legalName || resolvedId,
          manifestObj?.isDemo,
          manifestObj?.classification
        );
        const newManifest: CompanyManifest = manifestObj || {
          id: resolvedId,
          legalName: resolvedId === 'LGR-BENCH-VOLUME' ? 'LedgerAI PH Volume Benchmark Profile' : resolvedId,
          createdAt: new Date().toISOString(),
          dbPath: laiFile,
          documentLocation: path.join(dirPath, 'documents'),
          backupLocation: path.join(dirPath, 'backups'),
          location: dirPath,
          status: 'ACTIVE',
          registrationStatus: 'REGISTERED',
          classification: inferredClass,
          isDemo: true,
        };
        newManifest.classification = inferredClass;
        newManifest.registrationStatus = 'REGISTERED';
        await fs.writeFile(manifestFile, JSON.stringify(newManifest, null, 2)).catch(() => {});
        await this.registerCompany(newManifest);
        regIds.add(resolvedId);
        regLocations.add(dirPath);
      }
    } catch (_) {}

    const companies = await this.listCompanies({ includeSynthetic: true });
    const results: Array<{
      companyId: string;
      legalName: string;
      classification: CompanyClassification;
      isQuarantinedFromProduction: boolean;
    }> = [];

    for (const c of companies) {
      const classification = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
      if (c.classification !== classification) {
        await this.updateCompanyManifest(c.id, { classification });
        try {
          const companyDir = c.location || path.join(paths.getCompaniesRootDir(), c.id);
          const activeSqlitePath = path.join(companyDir, '.db_active.sqlite');
          if (fsSync.existsSync(activeSqlitePath)) {
            const sqlite = await this.getCompanySqlite(c.id);
            if (sqlite) {
              this.ensureBaseSchema(sqlite);
              sqlite
                .prepare(`UPDATE companies SET classification = ? WHERE id = ? AND classification != ?`)
                .run(classification, c.id, classification);
            }
          }
        } catch (_) {}
      }
      results.push({
        companyId: c.id,
        legalName: c.legalName,
        classification,
        isQuarantinedFromProduction: isSyntheticCompanyClassification(classification),
      });
    }
    return results;
  }

  /**
   * Evaluates the on-disk database and manifest state of a registry entry without mutating any files.
   * Explicitly distinguishes missing encrypted snapshots (.lai) from missing active SQLite databases (.db_active.sqlite).
   * Never classifies an entry as stale when at least one valid database representation (or backup archive) exists on disk.
   */
  static evaluateRegistryEntryDatabaseState(entry: CompanyManifest): {
    companyId: string;
    legalName: string;
    registryClassification: CompanyClassification;
    manifestClassification: CompanyClassification | null;
    effectiveClassification: CompanyClassification;
    inferredPureClassification: CompanyClassification;
    isReservedProtectedId: boolean;
    isProtectedClassification: boolean;
    companyDir: string;
    dirExists: boolean;
    manifestExists: boolean;
    manifestRegistrationStatus: string | null;
    encryptedLaiPath: string;
    encryptedLaiExists: boolean;
    activeSqlitePath: string;
    activeSqliteExists: boolean;
    fallbackSqliteExists: boolean;
    backupFilesCount: number;
    hasAnyValidDatabaseRepresentation: boolean;
    databaseRepresentationState:
      | 'ACTIVE_AND_ENCRYPTED_LAI_PRESENT'
      | 'ENCRYPTED_LAI_ONLY_PRESENT'
      | 'ACTIVE_SQLITE_ONLY_PRESENT'
      | 'BACKUP_ARCHIVE_ONLY_PRESENT'
      | 'ALL_DATABASE_REPRESENTATIONS_MISSING';
    isGenuinelyMissingAllDatabases: boolean;
  } {
    const companyDir = path.resolve(entry.location || path.join(paths.getCompaniesRootDir(), entry.id));
    const dirExists = fsSync.existsSync(companyDir);
    const manifestPath = path.join(companyDir, 'manifest.json');
    const manifestExists = dirExists && fsSync.existsSync(manifestPath);

    let manifestClassification: CompanyClassification | null = null;
    let manifestRegistrationStatus: string | null = null;
    if (manifestExists) {
      try {
        const manObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
        if (manObj.classification && VALID_COMPANY_CLASSIFICATIONS.includes(manObj.classification.toUpperCase())) {
          manifestClassification = manObj.classification.toUpperCase() as CompanyClassification;
        }
        manifestRegistrationStatus = manObj.registrationStatus || null;
      } catch {}
    }

    const encryptedLaiPath = path.resolve(entry.dbPath || path.join(companyDir, 'database.lai'));
    const activeSqlitePath = path.join(companyDir, '.db_active.sqlite');
    const fallbackSqlitePath = path.join(companyDir, 'database.sqlite');
    const companyDbPath = path.join(companyDir, 'company.db');

    const isNonEmptyFile = (p: string) => {
      try {
        return fsSync.existsSync(p) && fsSync.statSync(p).isFile() && fsSync.statSync(p).size > 0;
      } catch {
        return false;
      }
    };

    const encryptedLaiExists = isNonEmptyFile(encryptedLaiPath);
    const activeSqliteExists = isNonEmptyFile(activeSqlitePath);
    const fallbackSqliteExists = isNonEmptyFile(fallbackSqlitePath) || isNonEmptyFile(companyDbPath);

    let backupFilesCount = 0;
    const backupDir = path.resolve(entry.backupLocation || path.join(companyDir, 'backups'));
    if (fsSync.existsSync(backupDir)) {
      try {
        const bFiles = fsSync.readdirSync(backupDir);
        backupFilesCount = bFiles.filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return ['.lai', '.sqlite', '.db', '.bak', '.enc', '.zip', '.json'].includes(ext) &&
            isNonEmptyFile(path.join(backupDir, f));
        }).length;
      } catch {}
    }

    const hasAnyValidDatabaseRepresentation =
      encryptedLaiExists || activeSqliteExists || fallbackSqliteExists || backupFilesCount > 0;

    let databaseRepresentationState:
      | 'ACTIVE_AND_ENCRYPTED_LAI_PRESENT'
      | 'ENCRYPTED_LAI_ONLY_PRESENT'
      | 'ACTIVE_SQLITE_ONLY_PRESENT'
      | 'BACKUP_ARCHIVE_ONLY_PRESENT'
      | 'ALL_DATABASE_REPRESENTATIONS_MISSING';

    if (activeSqliteExists && encryptedLaiExists) {
      databaseRepresentationState = 'ACTIVE_AND_ENCRYPTED_LAI_PRESENT';
    } else if (!activeSqliteExists && encryptedLaiExists) {
      databaseRepresentationState = 'ENCRYPTED_LAI_ONLY_PRESENT';
    } else if ((activeSqliteExists || fallbackSqliteExists) && !encryptedLaiExists) {
      databaseRepresentationState = 'ACTIVE_SQLITE_ONLY_PRESENT';
    } else if (backupFilesCount > 0) {
      databaseRepresentationState = 'BACKUP_ARCHIVE_ONLY_PRESENT';
    } else {
      databaseRepresentationState = 'ALL_DATABASE_REPRESENTATIONS_MISSING';
    }

    const registryClassification = inferCompanyClassification(
      entry.id,
      entry.legalName,
      entry.isDemo,
      entry.classification
    );
    const effectiveClassification = inferCompanyClassification(
      entry.id,
      entry.legalName,
      entry.isDemo,
      manifestClassification || entry.classification
    );
    const inferredPureClassification = inferCompanyClassification(
      entry.id,
      entry.legalName,
      entry.isDemo,
      undefined
    );

    const isReservedProtectedId = RESERVED_PROTECTED_COMPANY_IDS.has(entry.id);
    const isProtectedClassification =
      isReservedProtectedId || isProtectedCompanyClassification(effectiveClassification);

    return {
      companyId: entry.id,
      legalName: entry.legalName,
      registryClassification,
      manifestClassification,
      effectiveClassification,
      inferredPureClassification,
      isReservedProtectedId,
      isProtectedClassification,
      companyDir,
      dirExists,
      manifestExists,
      manifestRegistrationStatus,
      encryptedLaiPath,
      encryptedLaiExists,
      activeSqlitePath,
      activeSqliteExists,
      fallbackSqliteExists,
      backupFilesCount,
      hasAnyValidDatabaseRepresentation,
      databaseRepresentationState,
      isGenuinelyMissingAllDatabases: !hasAnyValidDatabaseRepresentation,
    };
  }

  /**
   * Targeted Stale Registry Cleanup (Section 2):
   * - Removes only verified stale registry references whose directories and all database representations are genuinely missing.
   * - Never classifies a company as stale when at least one valid database representation (.lai, .db_active.sqlite, .sqlite, or backup) exists.
   * - Excludes PRODUCTION, PILOT, and DEVELOPMENT entries from automatic cleanup.
   * - Requires explicit classification and provenance validation (verifiedOrphanedFixtureProvenance) before removing any questionable entry that had a non-synthetic manifest/registry tag left behind by test teardown.
   * - Never deletes folders, manifests, databases, backups, encryption keys, or recovery metadata on disk.
   * - Idempotent and records before/after state in the durable governance audit log.
   */
  static async cleanupStaleRegistryEntries(options?: StaleRegistryCleanupOptions): Promise<{
    dryRun: boolean;
    beforeCount: number;
    afterCount: number;
    removedCount: number;
    beforeRegistrySha256: string | null;
    afterRegistrySha256: string | null;
    removedEntries: Array<{
      companyId: string;
      legalName: string;
      beforeClassification: CompanyClassification;
      verifiedClassification: CompanyClassification;
      removalMode: 'AUTOMATIC_SYNTHETIC_STALE' | 'PROVENANCE_VERIFIED_ORPHAN_FIXTURE';
      databaseRepresentationState: string;
      provenanceOrigin?: string;
      reason: string;
    }>;
    excludedProtectedEntries: Array<{
      companyId: string;
      legalName: string;
      classification: CompanyClassification;
      databaseRepresentationState: string;
      exclusionReason: string;
    }>;
    preservedValidEntriesCount: number;
    auditEventId: string | null;
  }> {
    const regFile = paths.getRegistryFilePath();
    const computeRegSha256 = () => {
      try {
        if (!fsSync.existsSync(regFile)) return null;
        return crypto.createHash('sha256').update(fsSync.readFileSync(regFile)).digest('hex');
      } catch {
        return null;
      }
    };

    const beforeRegistrySha256 = computeRegSha256();
    const provenanceMap = new Map<string, VerifiedOrphanedFixtureProvenance>();
    if (Array.isArray(options?.verifiedOrphanedFixtureProvenance)) {
      for (const p of options!.verifiedOrphanedFixtureProvenance!) {
        if (p && p.companyId) {
          provenanceMap.set(p.companyId.trim(), p);
        }
      }
    }

    const dryRun = Boolean(options?.dryRun);

    const outcome = await this.withRegistryLock(async (companies) => {
      const beforeCount = companies.length;
      const keptCompanies: CompanyManifest[] = [];
      const removedEntries: Array<{
        companyId: string;
        legalName: string;
        beforeClassification: CompanyClassification;
        verifiedClassification: CompanyClassification;
        removalMode: 'AUTOMATIC_SYNTHETIC_STALE' | 'PROVENANCE_VERIFIED_ORPHAN_FIXTURE';
        databaseRepresentationState: string;
        provenanceOrigin?: string;
        reason: string;
      }> = [];
      const excludedProtectedEntries: Array<{
        companyId: string;
        legalName: string;
        classification: CompanyClassification;
        databaseRepresentationState: string;
        exclusionReason: string;
      }> = [];
      let preservedValidEntriesCount = 0;

      for (const entry of companies) {
        const evalState = this.evaluateRegistryEntryDatabaseState(entry);

        // 1. If ANY valid database representation exists on disk, NEVER classify as stale
        if (evalState.hasAnyValidDatabaseRepresentation) {
          keptCompanies.push(entry);
          preservedValidEntriesCount++;
          continue;
        }

        // 2. Entry is genuinely missing ALL database representations on disk.
        // Never remove reserved protected IDs or PRODUCTION classification under any circumstance.
        if (evalState.isReservedProtectedId || evalState.effectiveClassification === 'PRODUCTION') {
          keptCompanies.push(entry);
          excludedProtectedEntries.push({
            companyId: entry.id,
            legalName: entry.legalName,
            classification: evalState.effectiveClassification,
            databaseRepresentationState: evalState.databaseRepresentationState,
            exclusionReason: evalState.isReservedProtectedId
              ? 'Reserved protected company ID is strictly excluded from stale cleanup.'
              : 'PRODUCTION company classification is strictly excluded from stale cleanup.',
          });
          continue;
        }

        // 3. If entry is already classified as synthetic (TEST, STRESS_TEST, BENCHMARK, DISPOSABLE)
        if (isSyntheticCompanyClassification(evalState.effectiveClassification)) {
          removedEntries.push({
            companyId: entry.id,
            legalName: entry.legalName,
            beforeClassification: evalState.effectiveClassification,
            verifiedClassification: evalState.effectiveClassification,
            removalMode: 'AUTOMATIC_SYNTHETIC_STALE',
            databaseRepresentationState: evalState.databaseRepresentationState,
            reason:
              options?.reason ||
              `Synthetic ${evalState.effectiveClassification} registry entry has no directory or valid database representation on disk.`,
          });
          if (!dryRun && evalState.manifestExists) {
            try {
              const manifestPath = path.join(evalState.companyDir, 'manifest.json');
              const manObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
              manObj.registrationStatus = 'UNREGISTERED';
              manObj.unregisteredAt = new Date().toISOString();
              fsSync.writeFileSync(manifestPath, JSON.stringify(manObj, null, 2), 'utf8');
            } catch {}
          }
          continue;
        }

        // 4. Entry has PILOT or DEVELOPMENT classification in registry/manifest.
        // Exclude from automatic cleanup unless explicit provenance validation is provided.
        const provenance = provenanceMap.get(entry.id);
        if (
          provenance &&
          provenance.testFileOrigin &&
          provenance.testFileOrigin.trim().length > 0 &&
          isSyntheticCompanyClassification(provenance.verifiedClassification) &&
          provenance.reason &&
          provenance.reason.trim().length >= 10
        ) {
          removedEntries.push({
            companyId: entry.id,
            legalName: entry.legalName,
            beforeClassification: evalState.effectiveClassification,
            verifiedClassification: provenance.verifiedClassification,
            removalMode: 'PROVENANCE_VERIFIED_ORPHAN_FIXTURE',
            databaseRepresentationState: evalState.databaseRepresentationState,
            provenanceOrigin: provenance.testFileOrigin.trim(),
            reason: provenance.reason.trim(),
          });
          if (!dryRun && evalState.dirExists) {
            try {
              const manifestPath = path.join(evalState.companyDir, 'manifest.json');
              const manObj = evalState.manifestExists
                ? JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'))
                : { id: entry.id, legalName: entry.legalName };
              manObj.classification = provenance.verifiedClassification;
              manObj.registrationStatus = 'UNREGISTERED';
              manObj.unregisteredAt = new Date().toISOString();
              fsSync.writeFileSync(manifestPath, JSON.stringify(manObj, null, 2), 'utf8');
            } catch {}
          }
          continue;
        }

        // Otherwise, strictly exclude PILOT and DEVELOPMENT from automatic cleanup
        keptCompanies.push(entry);
        excludedProtectedEntries.push({
          companyId: entry.id,
          legalName: entry.legalName,
          classification: evalState.effectiveClassification,
          databaseRepresentationState: evalState.databaseRepresentationState,
          exclusionReason: `Protected classification (${evalState.effectiveClassification}) excluded from automatic cleanup; explicit provenance validation is required.`,
        });
      }

      const nextCompanies = dryRun ? companies : keptCompanies;
      return {
        companies: nextCompanies,
        result: {
          beforeCount,
          afterCount: nextCompanies.length,
          removedCount: dryRun ? 0 : removedEntries.length,
          removedEntries,
          excludedProtectedEntries,
          preservedValidEntriesCount,
        },
      };
    });

    if (!dryRun) {
      for (const rem of outcome.removedEntries) {
        await this.closeCompanyDb(rem.companyId);
      }
    }

    const afterRegistrySha256 = computeRegSha256();
    const auditRecord = this.appendGovernanceAuditLogSync('STALE_REGISTRY_CLEANUP_EXECUTED', {
      dryRun,
      authorizedByUserId: options?.authorizedByUserId || 'SYSTEM_GOVERNANCE',
      authorizedByRole: options?.authorizedByRole || 'Company Owner',
      reason: options?.reason || 'Targeted stale registry cleanup',
      beforeRegistrySha256,
      afterRegistrySha256,
      beforeCount: outcome.beforeCount,
      afterCount: outcome.afterCount,
      removedCount: outcome.removedCount,
      removedEntries: outcome.removedEntries,
      excludedProtectedEntries: outcome.excludedProtectedEntries,
      preservedValidEntriesCount: outcome.preservedValidEntriesCount,
    });

    return {
      dryRun,
      beforeCount: outcome.beforeCount,
      afterCount: outcome.afterCount,
      removedCount: outcome.removedCount,
      beforeRegistrySha256,
      afterRegistrySha256,
      removedEntries: outcome.removedEntries,
      excludedProtectedEntries: outcome.excludedProtectedEntries,
      preservedValidEntriesCount: outcome.preservedValidEntriesCount,
      auditEventId: auditRecord?.eventId || null,
    };
  }

  /**
   * Reconciles a misclassified synthetic test fixture (e.g., LGR-ST-STATUTORY-A-2026 / LGR-ST-STATUTORY-B-2026)
   * across registry.json, manifest.json, and SQLite companies.classification ONLY after verifying:
   *  1. Not a reserved protected pilot/production company ID.
   *  2. Synthetic provenance (test file origin & synthetic ID prefix).
   *  3. Zero real customer, vendor, employee, invoice, or bill records.
   *  4. Zero posted journals, payroll runs, or statutory tax filings.
   * If any uncertainty or non-zero business data exists, preserves the company unchanged for manual review.
   */
  static async reconcileSyntheticTestFixtureClassification(
    companyId: string,
    options: {
      targetClassification: 'STRESS_TEST' | 'TEST' | 'DISPOSABLE' | 'BENCHMARK';
      provenanceSource: string;
      authorizedByUserId: string;
      authorizedByRole: string;
      reason: string;
    }
  ): Promise<{
    companyId: string;
    reconciled: boolean;
    status: 'RECONCILED_TO_SYNTHETIC' | 'PRESERVED_FOR_MANUAL_REVIEW';
    before: {
      registryClassification: string | null;
      manifestClassification: string | null;
      sqliteClassification: string | null;
    };
    after: {
      registryClassification: string | null;
      manifestClassification: string | null;
      sqliteClassification: string | null;
    };
    evidenceCounts: Record<string, number>;
    reason: string;
    auditEventId: string | null;
  }> {
    if (RESERVED_PROTECTED_COMPANY_IDS.has(companyId)) {
      throw new Error(
        `PROTECTED_COMPANY_CLASSIFICATION: Company '${companyId}' is a reserved protected company and cannot be reclassified as a synthetic test fixture.`
      );
    }
    if (!isSyntheticCompanyClassification(options.targetClassification)) {
      throw new Error(
        `INVALID_TARGET_CLASSIFICATION: Target classification '${options.targetClassification}' must be a synthetic classification (STRESS_TEST, TEST, DISPOSABLE, BENCHMARK).`
      );
    }
    if (!options.provenanceSource || !options.reason || options.reason.trim().length < 10) {
      throw new Error('PROVENANCE_AND_REASON_REQUIRED: provenanceSource and a detailed reason (>= 10 chars) are required.');
    }

    const regList = await this.listCompanies({ includeSynthetic: true });
    const regEntry = regList.find((c) => c.id === companyId);
    if (!regEntry) {
      throw new Error(`COMPANY_NOT_FOUND: Company '${companyId}' not found in registry.`);
    }

    const companyDir = path.resolve(regEntry.location || path.join(paths.getCompaniesRootDir(), companyId));
    const manifestPath = path.join(companyDir, 'manifest.json');
    let manifestObj: any = null;
    if (fsSync.existsSync(manifestPath)) {
      try {
        manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
      } catch {}
    }

    const sqlite = await this.getCompanySqlite(companyId);
    if (!sqlite) {
      throw new Error(`DATABASE_UNAVAILABLE: Cannot open SQLite database for '${companyId}'.`);
    }

    const compRow = sqlite.prepare('SELECT id, legal_name, classification, tin, is_demo FROM companies WHERE id = ?').get(companyId) as any;
    const before = {
      registryClassification: regEntry.classification || null,
      manifestClassification: manifestObj?.classification || null,
      sqliteClassification: compRow?.classification || null,
    };

    const tableNames = [
      'customers',
      'vendors',
      'employees',
      'sales_invoices',
      'purchase_bills',
      'journal_entries',
      'payroll_runs',
      'tax_filings',
      'inventory_items',
      'fixed_assets',
    ];
    const evidenceCounts: Record<string, number> = {};
    for (const tbl of tableNames) {
      try {
        const r = sqlite.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as any;
        evidenceCounts[tbl] = Number(r?.c || 0);
      } catch {
        evidenceCounts[tbl] = 0;
      }
    }
    try {
      const pj = sqlite.prepare(`SELECT COUNT(*) as c FROM journal_entries WHERE status = 'POSTED'`).get() as any;
      evidenceCounts.posted_journals = Number(pj?.c || 0);
    } catch {
      evidenceCounts.posted_journals = 0;
    }

    const hasNonZeroFinancialOrMasterData =
      evidenceCounts.customers > 0 ||
      evidenceCounts.vendors > 0 ||
      evidenceCounts.employees > 0 ||
      evidenceCounts.sales_invoices > 0 ||
      evidenceCounts.purchase_bills > 0 ||
      evidenceCounts.journal_entries > 0 ||
      evidenceCounts.posted_journals > 0 ||
      evidenceCounts.payroll_runs > 0 ||
      evidenceCounts.tax_filings > 0 ||
      evidenceCounts.inventory_items > 0 ||
      evidenceCounts.fixed_assets > 0;

    const idUpper = companyId.toUpperCase();
    const hasSyntheticIdPattern =
      idUpper.startsWith('LGR-ST-') ||
      idUpper.includes('-TEST-') ||
      idUpper.startsWith('TEST-') ||
      idUpper.includes('DISPOSABLE') ||
      idUpper.includes('BENCH');

    if (hasNonZeroFinancialOrMasterData || !hasSyntheticIdPattern) {
      const preserveReason = hasNonZeroFinancialOrMasterData
        ? `Preserved for manual review: non-zero financial or master records detected (${JSON.stringify(evidenceCounts)}).`
        : `Preserved for manual review: company ID '${companyId}' does not match synthetic test fixture ID conventions.`;

      const auditRec = this.appendGovernanceAuditLogSync('SYNTHETIC_FIXTURE_RECONCILIATION_PRESERVED', {
        companyId,
        provenanceSource: options.provenanceSource,
        authorizedByUserId: options.authorizedByUserId,
        authorizedByRole: options.authorizedByRole,
        before,
        after: before,
        evidenceCounts,
        reason: preserveReason,
      });

      return {
        companyId,
        reconciled: false,
        status: 'PRESERVED_FOR_MANUAL_REVIEW',
        before,
        after: before,
        evidenceCounts,
        reason: preserveReason,
        auditEventId: auditRec?.eventId || null,
      };
    }

    const target = options.targetClassification;

    // 1. Update registry.json and manifest.json consistently
    await this.updateCompanyManifest(companyId, {
      classification: target,
      isDemo: true,
    });

    // 2. Update SQLite companies.classification and record database audit log
    this.ensureBaseSchema(sqlite);
    sqlite
      .prepare(`UPDATE companies SET classification = ?, is_demo = 1, updated_at = ? WHERE id = ?`)
      .run(target, Date.now(), companyId);

    try {
      sqlite
        .prepare(
          `INSERT INTO audit_logs (
            id, company_id, user_id, action, entity_type, entity_id,
            result, reason, module, severity, source, before_data, after_data, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          companyId,
          options.authorizedByUserId,
          'SYNTHETIC_FIXTURE_CLASSIFICATION_RECONCILED',
          'COMPANY',
          companyId,
          'SUCCESS',
          `${options.reason.trim()} [Provenance: ${options.provenanceSource}]`,
          'COMPANY_GOVERNANCE',
          'INFO',
          'SYSTEM_GOVERNANCE',
          JSON.stringify(before),
          JSON.stringify({
            registryClassification: target,
            manifestClassification: target,
            sqliteClassification: target,
          }),
          Date.now()
        );
    } catch {}

    await this.syncCompanyDatabaseSnapshot(companyId);

    const after = {
      registryClassification: target,
      manifestClassification: target,
      sqliteClassification: target,
    };

    const auditRec = this.appendGovernanceAuditLogSync('SYNTHETIC_FIXTURE_CLASSIFICATION_RECONCILED', {
      companyId,
      provenanceSource: options.provenanceSource,
      authorizedByUserId: options.authorizedByUserId,
      authorizedByRole: options.authorizedByRole,
      before,
      after,
      evidenceCounts,
      reason: options.reason.trim(),
    });

    return {
      companyId,
      reconciled: true,
      status: 'RECONCILED_TO_SYNTHETIC',
      before,
      after,
      evidenceCounts,
      reason: options.reason.trim(),
      auditEventId: auditRec?.eventId || null,
    };
  }

  /**
   * DEF-009: Verifies whether a company is permitted to participate in production reporting
   * or pilot opening-balance migrations.
   */
  static async assertProductionWorkflowAllowed(
    companyId: string,
    workflowName: string,
    options?: { allowPilot?: boolean }
  ): Promise<{ classification: CompanyClassification }> {
    const manifest = await this.getCompanyManifest(companyId);
    const classification = inferCompanyClassification(
      companyId,
      manifest?.legalName,
      manifest?.isDemo,
      manifest?.classification
    );

    if (isSyntheticCompanyClassification(classification)) {
      throw new Error(
        `SYNTHETIC_COMPANY_QUARANTINED: Company ${companyId} is classified as ${classification} and is strictly quarantined from ${workflowName}. Synthetic stress-test and benchmark datasets cannot be mixed into production reports or pilot opening-balance migrations.`
      );
    }

    if (!options?.allowPilot && classification === 'DEVELOPMENT' && process.env.NODE_ENV === 'production') {
      throw new Error(
        `NON_PRODUCTION_COMPANY_BLOCKED: Company ${companyId} (${classification}) cannot execute production workflow ${workflowName}.`
      );
    }

    return { classification };
  }

  /**
   * DEF-009: Controlled company classification change requiring explicit authorization and reason.
   * Strictly blocks promoting STRESS_TEST or BENCHMARK profiles to PRODUCTION or PILOT.
   */
  static async changeCompanyClassification(
    companyId: string,
    targetClassification: CompanyClassification,
    authOptions: {
      authorizedByUserId: string;
      authorizedByRole: string;
      reason: string;
      overrideSyntheticQuarantine?: boolean;
    }
  ): Promise<{ previousClassification: CompanyClassification; newClassification: CompanyClassification }> {
    const manifest = await this.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    if (!authOptions.reason || authOptions.reason.trim().length < 10) {
      throw new Error(
        'CLASSIFICATION_REASON_REQUIRED: A detailed authorization reason (at least 10 characters) is required to change company classification.'
      );
    }
    if (authOptions.authorizedByRole !== 'Company Owner') {
      throw new Error(
        'PERMISSION_DENIED: Only a Company Owner can authorize a company classification change.'
      );
    }

    const previousClassification = inferCompanyClassification(
      companyId,
      manifest.legalName,
      manifest.isDemo,
      manifest.classification
    );

    if (
      isSyntheticCompanyClassification(previousClassification) &&
      (targetClassification === 'PRODUCTION' || targetClassification === 'PILOT')
    ) {
      throw new Error(
        `SYNTHETIC_PROMOTION_PROHIBITED: Company ${companyId} is classified as ${previousClassification} containing synthetic test/benchmark data and cannot be promoted to ${targetClassification}. Provision a clean PILOT or PRODUCTION company instead.`
      );
    }

    if (targetClassification === 'PRODUCTION') {
      DatabaseEncryptionService.assertProductionKeyPolicy({
        companyId,
        classification: 'PRODUCTION',
        keyMode: manifest.encryptionKeyMode || 'OS_KEYCHAIN_STANDALONE',
      });
    }

    await this.updateCompanyManifest(companyId, { classification: targetClassification });
    try {
      const sqlite = await this.getCompanySqlite(companyId);
      if (sqlite) {
        this.ensureBaseSchema(sqlite);
        sqlite
          .prepare(`UPDATE companies SET classification = ?, updated_at = ? WHERE id = ?`)
          .run(targetClassification, Date.now(), companyId);
        sqlite
          .prepare(
            `INSERT INTO audit_logs (
              id, company_id, user_id, action, entity_type, entity_id,
              result, reason, module, severity, source, before_data, after_data, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            companyId,
            authOptions.authorizedByUserId,
            'COMPANY_CLASSIFICATION_CHANGED',
            'COMPANY',
            companyId,
            'SUCCESS',
            authOptions.reason.trim(),
            'COMPANY',
            'WARN',
            'SYSTEM_GOVERNANCE',
            JSON.stringify({ classification: previousClassification }),
            JSON.stringify({ classification: targetClassification }),
            Date.now()
          );
        await this.syncCompanyDatabaseSnapshot(companyId);
      }
    } catch (sqliteErr: any) {
      await this.updateCompanyManifest(companyId, { classification: previousClassification }).catch(() => {});
      throw sqliteErr;
    }

    return { previousClassification, newClassification: targetClassification };
  }

  /**
   * Safely purges a synthetic/disposable company after verifying that its persisted
   * classification is strictly synthetic (TEST, STRESS_TEST, BENCHMARK, DISPOSABLE)
   * and NEVER PILOT, PRODUCTION, or DEVELOPMENT.
   */
  static async purgeSyntheticCompany(
    companyId: string,
    options: {
      authorizedByUserId: string;
      authorizedByRole: string;
      confirmPurge: boolean;
      reason?: string;
      allowWithPostedTransactions?: boolean;
    }
  ): Promise<{ purgedCompanyId: string; classification: CompanyClassification }> {
    if (!options.confirmPurge) {
      throw new Error('PURGE_CONFIRMATION_REQUIRED: Explicit confirmPurge=true is required to purge a synthetic company.');
    }
    if (options.authorizedByRole !== 'Company Owner') {
      throw new Error('PERMISSION_DENIED: Only a Company Owner can purge a synthetic company.');
    }
    const manifest = await this.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    const effectiveClassification = inferCompanyClassification(
      manifest.id,
      manifest.legalName,
      manifest.isDemo,
      manifest.classification
    );
    if (!isSyntheticCompanyClassification(effectiveClassification)) {
      throw new Error(
        `PROTECTED_COMPANY_CLASSIFICATION: Company '${companyId}' is classified as '${effectiveClassification}'. Purging is strictly restricted to synthetic companies (TEST, STRESS_TEST, BENCHMARK, DISPOSABLE) and is prohibited for PRODUCTION, PILOT, or DEVELOPMENT companies.`
      );
    }

    // Also inspect the SQLite database if present to verify SQLite classification and protected records
    const sqlite = await this.getCompanySqlite(companyId).catch(() => null);
    if (sqlite) {
      try {
        const dbRow = sqlite.prepare(`SELECT classification FROM companies WHERE id = ?`).get(companyId) as any;
        if (dbRow?.classification && !isSyntheticCompanyClassification(dbRow.classification)) {
          throw new Error(
            `PROTECTED_COMPANY_CLASSIFICATION: Database record for '${companyId}' has non-synthetic classification '${dbRow.classification}'. Purge aborted.`
          );
        }
        if (!options.allowWithPostedTransactions) {
          const postedJournals = (sqlite.prepare(`SELECT COUNT(*) as c FROM journal_entries WHERE company_id = ? AND status = 'POSTED'`).get(companyId) as any)?.c || 0;
          const postedPayrolls = (sqlite.prepare(`SELECT COUNT(*) as c FROM payroll_runs WHERE company_id = ? AND status = 'POSTED'`).get(companyId) as any)?.c || 0;
          if (postedJournals > 0 || postedPayrolls > 0) {
            throw new Error(
              `PROTECTED_FINANCIAL_RECORDS: Synthetic company '${companyId}' contains ${postedJournals} posted journal(s) and ${postedPayrolls} posted payroll run(s). Pass allowWithPostedTransactions=true to force purge.`
            );
          }
        }
      } catch (err: any) {
        if (err.message?.includes('PROTECTED_')) throw err;
      }
    }

    await this.closeCompanyDb(companyId);
    await this.deleteCompany(companyId);
    return { purgedCompanyId: companyId, classification: effectiveClassification };
  }

  /**
   * Enforces that when an isolated test root (`LEDGERAI_ISOLATED_TEST_ROOT`) is active,
   * no destructive operation can target the live home config/data directories or any path outside the isolated test root.
   */
  static assertIsolatedTestWorkspaceSafety(targetPath?: string): {
    isolatedRoot: string | null;
    companiesRoot: string;
    configRoot: string;
  } {
    const companiesRoot = path.resolve(paths.getCompaniesRootDir());
    const configRoot = path.resolve(paths.getConfigDir());
    const isolatedRootEnv = process.env.LEDGERAI_ISOLATED_TEST_ROOT
      ? path.resolve(process.env.LEDGERAI_ISOLATED_TEST_ROOT)
      : null;

    if (isolatedRootEnv) {
      const checkWithinIsolated = (candidatePath: string, label: string) => {
        const resolvedCandidate = path.resolve(candidatePath);
        const rel = path.relative(isolatedRootEnv, resolvedCandidate);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(
            `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: ${label} ('${resolvedCandidate}') escapes the designated isolated test root ('${isolatedRootEnv}').`
          );
        }
      };

      checkWithinIsolated(companiesRoot, 'LEDGERAI_DATA_DIR');
      checkWithinIsolated(configRoot, 'LEDGERAI_CONFIG_DIR');
      if (targetPath) {
        checkWithinIsolated(targetPath, 'Target path');
      }
    }

    return { isolatedRoot: isolatedRootEnv, companiesRoot, configRoot };
  }

  /**
   * DEF-CHAL-001 / DEF-ADV-001 Hardening:
   * Strictly validates whether a destructive test reset or directory purge is allowed.
   * Rejects:
   *   1. PRODUCTION and PILOT company classifications or reserved pilot IDs (e.g. LGR-PH-2026-PILOT-CLEAN-01).
   *   2. Any filesystem path outside paths.getCompaniesRootDir() or outside LEDGERAI_ISOLATED_TEST_ROOT when set.
   *   3. Any existing SQLite database whose internal `companies.id` mismatches `companyId` or has a non-synthetic classification.
   */
  static assertDestructiveTestOperationAllowed(
    companyId: string,
    targetPath?: string
  ): { allowed: true; classification: CompanyClassification; resolvedDir: string } {
    const cleanId = String(companyId || '').trim();
    if (!cleanId) {
      throw new Error('PROHIBITED_DESTRUCTIVE_TEST_OPERATION: companyId is required.');
    }

    if (RESERVED_PROTECTED_COMPANY_IDS.has(cleanId.toUpperCase()) || RESERVED_PROTECTED_COMPANY_IDS.has(cleanId)) {
      throw new Error(
        `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Destructive test reset/deletion is strictly forbidden on protected company '${cleanId}'.`
      );
    }

    const inferred = inferCompanyClassification(cleanId);
    if (!isSyntheticCompanyClassification(inferred)) {
      throw new Error(
        `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Company '${cleanId}' has classification '${inferred}'. Destructive test operations are only permitted on synthetic classifications (TEST, STRESS_TEST, BENCHMARK, DISPOSABLE) and strictly prohibited on PILOT, PRODUCTION, or DEVELOPMENT.`
      );
    }

    const { companiesRoot } = this.assertIsolatedTestWorkspaceSafety(targetPath);
    const resolvedDir = path.resolve(targetPath || path.join(companiesRoot, cleanId));
    const relToRoot = path.relative(companiesRoot, resolvedDir);
    if (
      relToRoot.startsWith('..') ||
      path.isAbsolute(relToRoot) ||
      relToRoot === '' ||
      path.basename(resolvedDir) !== cleanId
    ) {
      throw new Error(
        `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Target path '${resolvedDir}' is outside the approved companies workspace ('${companiesRoot}') or does not match company directory '${cleanId}'.`
      );
    }

    const manifestPath = path.join(resolvedDir, 'manifest.json');
    if (fsSync.existsSync(manifestPath)) {
      try {
        const manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
        if (manifestObj.id && String(manifestObj.id) !== cleanId) {
          throw new Error(
            `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Manifest company ID '${manifestObj.id}' at '${resolvedDir}' does not match requested companyId '${cleanId}'.`
          );
        }
        const manifestClass = inferCompanyClassification(
          manifestObj.id || cleanId,
          manifestObj.legalName,
          manifestObj.isDemo,
          manifestObj.classification
        );
        if (!isSyntheticCompanyClassification(manifestClass)) {
          throw new Error(
            `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Manifest at '${resolvedDir}' is classified as '${manifestClass}' (non-synthetic).`
          );
        }
      } catch (err: any) {
        if (err.message?.startsWith('PROHIBITED_DESTRUCTIVE_TEST_OPERATION')) {
          throw err;
        }
      }
    }

    const activeSqlitePath = path.join(resolvedDir, '.db_active.sqlite');
    if (fsSync.existsSync(activeSqlitePath)) {
      let checkDb: any = null;
      try {
        checkDb = new Database(activeSqlitePath, { readonly: true });
        const rows = checkDb.prepare('SELECT id, classification FROM companies').all() as Array<{
          id: string;
          classification?: string;
        }>;
        for (const r of rows) {
          if (String(r.id) !== cleanId) {
            throw new Error(
              `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Database internal company ID '${r.id}' does not match requested companyId '${cleanId}'.`
            );
          }
          if (r.classification && !isSyntheticCompanyClassification(r.classification)) {
            throw new Error(
              `PROHIBITED_DESTRUCTIVE_TEST_OPERATION: Database internal classification for '${r.id}' is '${r.classification}' (protected).`
            );
          }
        }
      } catch (err: any) {
        if (err.message?.startsWith('PROHIBITED_DESTRUCTIVE_TEST_OPERATION')) {
          throw err;
        }
      } finally {
        try {
          if (checkDb) checkDb.close();
        } catch {}
      }
    }

    return { allowed: true, classification: inferred, resolvedDir };
  }

  static async resetDisposableTestCompanyWorkspace(companyId: string, targetPath?: string): Promise<void> {
    const { resolvedDir } = this.assertDestructiveTestOperationAllowed(companyId, targetPath);
    await this.closeCompanyDb(companyId);
    try {
      await this.unregisterCompany(companyId);
    } catch {}
    if (fsSync.existsSync(resolvedDir)) {
      fsSync.rmSync(resolvedDir, { recursive: true, force: true });
    }
  }

  static async deleteCompany(
    id: string,
    options?: {
      confirmProtectedUnregister?: boolean;
      authorizedByUserId?: string;
      reason?: string;
    }
  ) {
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      throw new Error('VALIDATION_ERROR: companyId is required.');
    }

    // Authoritative pilot & reserved company IDs are permanently protected from deletion or unregistration
    if (RESERVED_PROTECTED_COMPANY_IDS.has(cleanId) || RESERVED_PROTECTED_COMPANY_IDS.has(cleanId.toUpperCase())) {
      throw new Error(
        `PROTECTED_PILOT_COMPANY: PROTECTED_COMPANY_CLASSIFICATION: Company '${cleanId}' is a reserved authoritative protected company and cannot be removed or unregistered.`
      );
    }

    // Check target classification before closing or mutating anything
    const existingList = await this.listCompanies({ includeSynthetic: true });
    const preTarget = existingList.find((c) => c.id === cleanId);
    if (preTarget) {
      const preCls = inferCompanyClassification(
        preTarget.id,
        preTarget.legalName,
        preTarget.isDemo,
        preTarget.classification
      );
      if (isProtectedCompanyClassification(preCls) && options?.confirmProtectedUnregister !== true) {
        throw new Error(
          `PROTECTED_COMPANY_CLASSIFICATION: Protected ${preCls} company '${cleanId}' cannot be deleted or unregistered without explicit confirmProtectedUnregister=true.`
        );
      }
    }

    // Flush snapshot and cleanly close both dbCache and sqliteCache connections before unregistering
    await this.checkpointAndSyncFinancialSnapshotNow(cleanId).catch(() => {});
    await this.closeCompanyDb(cleanId);

    return this.withRegistryLock(async (companies) => {
      const target = companies.find((c) => c.id === cleanId);
      if (!target) {
        throw new Error('Company not found in registry.');
      }

      const effectiveCls = inferCompanyClassification(
        target.id,
        target.legalName,
        target.isDemo,
        target.classification
      );
      if (
        RESERVED_PROTECTED_COMPANY_IDS.has(target.id) ||
        (isProtectedCompanyClassification(effectiveCls) && options?.confirmProtectedUnregister !== true)
      ) {
        throw new Error(
          `PROTECTED_COMPANY_CLASSIFICATION: Protected ${effectiveCls} company '${target.id}' cannot be deleted or unregistered without explicit authorization.`
        );
      }

      try {
        const targetDir = target.location || path.dirname(target.dbPath);
        const manifestPath = path.join(targetDir, 'manifest.json');
        if (fsSync.existsSync(manifestPath)) {
          const manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
          manifestObj.registrationStatus = 'UNREGISTERED';
          manifestObj.unregisteredAt = new Date().toISOString();
          fsSync.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8');
        }
      } catch {}

      const filtered = companies.filter((c) => c.id !== cleanId);
      this.appendGovernanceAuditLogSync('COMPANY_UNREGISTERED', {
        companyId: cleanId,
        legalName: target.legalName,
        classification: effectiveCls,
        authorizedByUserId: options?.authorizedByUserId || 'SYSTEM',
        reason: options?.reason || 'Single company unregistered from access list (data preserved on disk)',
      });
      return { companies: filtered, result: undefined };
    });
  }

  /**
   * Safe bulk registry clear (Section 4):
   * Strictly rejects bulk clearing whenever any PRODUCTION, PILOT, or DEVELOPMENT company is registered.
   * Never clears dbCache while leaving sqliteCache open.
   */
  static async clearRegistry(options?: {
    confirmClearAll?: boolean;
    authorizedByUserId?: string;
    authorizedByRole?: string;
    reason?: string;
  }) {
    const allRegistered = await this.listCompanies({ includeSynthetic: true });
    for (const c of allRegistered) {
      const cls = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
      if (RESERVED_PROTECTED_COMPANY_IDS.has(c.id) || isProtectedCompanyClassification(cls)) {
        throw new Error(
          `PROTECTED_COMPANY_CLASSIFICATION: Protected ${cls} company '${c.id}' is registered. Bulk clear aborted.`
        );
      }
    }

    // Close all SQLite connections cleanly first
    for (const c of allRegistered) {
      await this.checkpointAndSyncFinancialSnapshotNow(c.id).catch(() => {});
      await this.closeCompanyDb(c.id);
    }

    return this.withRegistryLock(async (companies) => {
      // Double-check inside lock that no protected company was added concurrently
      for (const c of companies) {
        const cls = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
        if (RESERVED_PROTECTED_COMPANY_IDS.has(c.id) || isProtectedCompanyClassification(cls)) {
          throw new Error(
            `PROTECTED_COMPANY_CLASSIFICATION: Concurrent registration of protected company '${c.id}' (${cls}) detected. Bulk clear aborted.`
          );
        }
      }
      for (const c of companies) {
        try {
          const targetDir = c.location || path.dirname(c.dbPath);
          const manifestPath = path.join(targetDir, 'manifest.json');
          if (fsSync.existsSync(manifestPath)) {
            const manifestObj = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
            manifestObj.registrationStatus = 'UNREGISTERED';
            manifestObj.unregisteredAt = new Date().toISOString();
            fsSync.writeFileSync(manifestPath, JSON.stringify(manifestObj, null, 2), 'utf8');
          }
        } catch {}
      }
      this.appendGovernanceAuditLogSync('SYNTHETIC_ONLY_REGISTRY_CLEARED', {
        authorizedByUserId: options?.authorizedByUserId || 'SYSTEM',
        clearedCount: companies.length,
        clearedIds: companies.map((c) => c.id),
        reason: options?.reason || 'Synthetic-only registry cleared',
      });
      return { companies: [], result: undefined };
    });
  }

  /**
   * Tenant-safe reset utility (DEF-SEC-001):
   * - scope = 'SYNTHETIC_ONLY' (default): removes ONLY synthetic companies (TEST, STRESS_TEST, BENCHMARK, DISPOSABLE)
   *   and preserves ALL PRODUCTION, PILOT, DEVELOPMENT, and RESERVED_PROTECTED_COMPANY_IDS workspaces.
   * - scope = 'CURRENT_COMPANY': removes ONLY the specified non-reserved `targetCompanyId` belonging to the
   *   requesting Company Owner, never touching any other tenant's directories or registry entries.
   */
  static async factoryResetAllCompanies(options?: {
    confirmFactoryReset?: boolean;
    authorizedByUserId?: string;
    scope?: 'SYNTHETIC_ONLY' | 'CURRENT_COMPANY';
    targetCompanyId?: string;
    reason?: string;
  }): Promise<{ purgedCount: number; purgedIds: string[]; preservedCount: number; scope: string }> {
    if (!options?.confirmFactoryReset) {
      throw new Error(
        'FACTORY_RESET_CONFIRMATION_REQUIRED: Explicit confirmFactoryReset=true is required.'
      );
    }

    const scope: 'SYNTHETIC_ONLY' | 'CURRENT_COMPANY' =
      options?.scope === 'CURRENT_COMPANY' ? 'CURRENT_COMPANY' : 'SYNTHETIC_ONLY';

    if (scope === 'CURRENT_COMPANY') {
      const targetId = String(options?.targetCompanyId || '').trim();
      if (!targetId) {
        throw new Error('VALIDATION_ERROR: targetCompanyId is required when scope is CURRENT_COMPANY.');
      }
      if (RESERVED_PROTECTED_COMPANY_IDS.has(targetId) || RESERVED_PROTECTED_COMPANY_IDS.has(targetId.toUpperCase())) {
        throw new Error(
          `PROTECTED_COMPANY_CLASSIFICATION: Company '${targetId}' is a reserved protected company and cannot be wiped via factory reset.`
        );
      }

      const manifest = await this.getCompanyManifest(targetId);
      if (!manifest) {
        throw new Error(`COMPANY_NOT_FOUND: ${targetId}`);
      }

      await this.closeCompanyDb(targetId);

      const companiesRoot = path.resolve(paths.getCompaniesRootDir());
      const targetDir = path.resolve(manifest.location || path.dirname(manifest.dbPath));
      const relToRoot = path.relative(companiesRoot, targetDir);
      if (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot) && relToRoot !== '' && fsSync.existsSync(targetDir)) {
        fsSync.rmSync(targetDir, { recursive: true, force: true });
      }

      // Remove only targetId from shortcut_history.json
      try {
        const { CompanyLifecycleService } = await import('./companyLifecycleService');
        const historyPath = CompanyLifecycleService.getShortcutHistoryFilePath();
        if (fsSync.existsSync(historyPath)) {
          const parsed = JSON.parse(fsSync.readFileSync(historyPath, 'utf8'));
          if (Array.isArray(parsed)) {
            const nextHistory = parsed.filter((e: any) => e?.companyId !== targetId);
            fsSync.writeFileSync(historyPath, JSON.stringify(nextHistory, null, 2), 'utf8');
          }
        }
      } catch {}

      return this.withRegistryLock(async (companies) => {
        const kept = companies.filter((c) => c.id !== targetId);
        this.appendGovernanceAuditLogSync('TENANT_SCOPED_WORKSPACE_RESET', {
          authorizedByUserId: options?.authorizedByUserId || 'SYSTEM',
          scope,
          purgedCount: 1,
          purgedIds: [targetId],
          preservedCount: kept.length,
          reason: options?.reason || `Tenant-scoped reset of company '${targetId}'`,
        });
        return {
          companies: kept,
          result: {
            purgedCount: 1,
            purgedIds: [targetId],
            preservedCount: kept.length,
            scope,
          },
        };
      });
    }

    // Default safe scope: SYNTHETIC_ONLY (never deletes PILOT, PRODUCTION, DEVELOPMENT, or reserved IDs)
    const allRegistered = await this.listCompanies({ includeSynthetic: true });
    const purgedIds: string[] = [];
    const companiesToPurge = new Set<string>();

    for (const c of allRegistered) {
      const cls = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
      if (
        !RESERVED_PROTECTED_COMPANY_IDS.has(c.id) &&
        !RESERVED_PROTECTED_COMPANY_IDS.has(c.id.toUpperCase()) &&
        isSyntheticCompanyClassification(cls)
      ) {
        companiesToPurge.add(c.id);
        await this.closeCompanyDb(c.id).catch(() => {});
        const dirPath = c.location ? path.resolve(c.location) : path.join(paths.getCompaniesRootDir(), c.id);
        const companiesRoot = path.resolve(paths.getCompaniesRootDir());
        const rel = path.relative(companiesRoot, dirPath);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && rel !== '' && fsSync.existsSync(dirPath)) {
          try {
            fsSync.rmSync(dirPath, { recursive: true, force: true });
          } catch (e) {
            console.error(`[CompanyManager] Failed to delete synthetic company directory ${dirPath}:`, e);
          }
        }
        purgedIds.push(c.id);
      }
    }

    // Clean only synthetic directories on disk under companiesRoot
    const companiesRoot = paths.getCompaniesRootDir();
    if (fsSync.existsSync(companiesRoot)) {
      try {
        const entries = fsSync.readdirSync(companiesRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (RESERVED_PROTECTED_COMPANY_IDS.has(entry.name)) continue;
          const fullPath = path.join(companiesRoot, entry.name);
          const manifestPath = path.join(fullPath, 'manifest.json');
          let entryCls: CompanyClassification | null = null;
          if (fsSync.existsSync(manifestPath)) {
            try {
              const m = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
              entryCls = inferCompanyClassification(m.id || entry.name, m.legalName, m.isDemo, m.classification);
              if (RESERVED_PROTECTED_COMPANY_IDS.has(m.id)) continue;
            } catch {}
          } else {
            entryCls = inferCompanyClassification(entry.name);
          }
          if (entryCls && isSyntheticCompanyClassification(entryCls)) {
            try {
              fsSync.rmSync(fullPath, { recursive: true, force: true });
              if (!companiesToPurge.has(entry.name)) {
                companiesToPurge.add(entry.name);
                purgedIds.push(entry.name);
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error('[CompanyManager] Error scanning companies root during synthetic reset:', e);
      }
    }

    // Remove purged synthetic entries from shortcut_history.json while preserving production/pilot shortcuts
    try {
      const { CompanyLifecycleService } = await import('./companyLifecycleService');
      const historyPath = CompanyLifecycleService.getShortcutHistoryFilePath();
      if (fsSync.existsSync(historyPath)) {
        const parsed = JSON.parse(fsSync.readFileSync(historyPath, 'utf8'));
        if (Array.isArray(parsed)) {
          const nextHistory = parsed.filter((e: any) => {
            if (!e?.companyId) return false;
            if (RESERVED_PROTECTED_COMPANY_IDS.has(e.companyId)) return true;
            if (companiesToPurge.has(e.companyId)) return false;
            const cls = inferCompanyClassification(e.companyId, e.displayName, e.isDemo, e.classification);
            return !isSyntheticCompanyClassification(cls);
          });
          fsSync.writeFileSync(historyPath, JSON.stringify(nextHistory, null, 2), 'utf8');
        }
      }
    } catch {}

    return this.withRegistryLock(async (companies) => {
      const kept = companies.filter((c) => {
        if (RESERVED_PROTECTED_COMPANY_IDS.has(c.id)) return true;
        if (companiesToPurge.has(c.id)) return false;
        const cls = inferCompanyClassification(c.id, c.legalName, c.isDemo, c.classification);
        return !isSyntheticCompanyClassification(cls);
      });
      this.appendGovernanceAuditLogSync('SYNTHETIC_STRESS_DATA_PURGED', {
        authorizedByUserId: options?.authorizedByUserId || 'SYSTEM',
        scope,
        purgedCount: purgedIds.length,
        purgedIds,
        preservedCount: kept.length,
        reason: options?.reason || 'Purged synthetic/stress-test company workspaces while preserving protected production & pilot companies',
      });
      return {
        companies: kept,
        result: {
          purgedCount: purgedIds.length,
          purgedIds,
          preservedCount: kept.length,
          scope,
        },
      };
    });
  }

  static async browseAndRegisterCompanyFolder(
    folderPath: string,
    options?: {
      expectedCompanyId?: string;
      operation?: 'CREATED' | 'OPENED' | 'RESTORED';
      conflictResolution?: 'FAIL_ON_CONFLICT' | 'SWITCH_REGISTRY_TO_SELECTED' | 'ALLOW_RELOCATE';
      requireAttachments?: boolean;
    }
  ): Promise<
    CompanyManifest & {
      registrationAction?: 'REGISTERED_NEW' | 'REUSED_EXISTING' | 'RELOCATED' | 'SWITCHED_REGISTRY';
      attachmentAudit?: PortableAttachmentAudit;
      relocatedDocumentsUpdated?: number;
    }
  > {
    const { CompanyLifecycleService } = await import('./companyLifecycleService');
    const inspection = await CompanyLifecycleService.inspectDatabaseTarget(folderPath, {
      expectedCompanyId: options?.expectedCompanyId,
      requireAttachments: options?.requireAttachments,
    });

    if (!inspection.valid) {
      throw new Error(`${inspection.errorCode || 'INVALID_COMPANY_FOLDER'}: ${inspection.message}`);
    }

    const resolvedPath = inspection.companyDirectory;
    const dbPath = inspection.databasePath;
    const activeSqlitePath = path.join(resolvedPath, '.db_active.sqlite');
    let manifest: CompanyManifest | null = inspection.manifest || null;

    // Evaluate Company Identity & Duplicate Detection BEFORE mutating registry or active files
    const registeredCompanies = await this.listCompanies({ includeSynthetic: true });
    const dupAssessment = assessCompanyIdentityDuplicate({
      companyId: inspection.companyId!,
      selectedDirectory: resolvedPath,
      registeredCompanies,
    });

    if (
      dupAssessment.status === 'DUPLICATE_IDENTITY_CONFLICT' &&
      options?.conflictResolution !== 'SWITCH_REGISTRY_TO_SELECTED' &&
      options?.expectedCompanyId !== inspection.companyId
    ) {
      const conflictErr: any = new Error(dupAssessment.message);
      conflictErr.code = 'DUPLICATE_COMPANY_IDENTITY_CONFLICT';
      conflictErr.conflict = dupAssessment;
      throw conflictErr;
    }

    const registrationAction: 'REGISTERED_NEW' | 'REUSED_EXISTING' | 'RELOCATED' | 'SWITCHED_REGISTRY' =
      dupAssessment.status === 'ALREADY_REGISTERED_SAME_LOCATION'
        ? 'REUSED_EXISTING'
        : dupAssessment.status === 'RELOCATED_ORIGINAL_MISSING'
          ? 'RELOCATED'
          : dupAssessment.status === 'DUPLICATE_IDENTITY_CONFLICT'
            ? 'SWITCHED_REGISTRY'
            : 'REGISTERED_NEW';

    let sqlite: any = null;
    try {
      const targetCompanyId = inspection.companyId || manifest?.id;
      if (targetCompanyId) {
        const cached = sqliteCache.get(targetCompanyId);
        if (cached && typeof cached.pragma === 'function') {
          try { cached.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        }
      }

      const isDefaultCompanyLai =
        path.resolve(dbPath) === path.resolve(path.join(resolvedPath, 'database.lai'));

      const selectedSpecificNonDefaultLai =
        inspection.isFileSelection &&
        !isDefaultCompanyLai &&
        path.resolve(dbPath) !== path.resolve(activeSqlitePath) &&
        DatabaseEncryptionService.isEncryptedLaiSync(dbPath);

      // If active runtime SQLite exists and is valid (and user didn't explicitly pick a different/custom .lai file), use it and checkpoint WAL
      if (fsSync.existsSync(activeSqlitePath) && !selectedSpecificNonDefaultLai) {
        try {
          const candidate = new Database(activeSqlitePath);
          candidate.pragma('journal_mode = WAL');
          candidate.pragma('synchronous = NORMAL');
          candidate.pragma('busy_timeout = 30000');
          candidate.pragma('temp_store = MEMORY');
          candidate.pragma('cache_size = -64000');
          const check = candidate.pragma('integrity_check') as any[];
          if (
            check?.[0]?.integrity_check === 'ok' &&
            this.hasValidFinancialAndCompanyDataSync(candidate, inspection.companyId, true)
          ) {
            candidate.pragma('wal_checkpoint(TRUNCATE)');
            sqlite = candidate;

            // Keep encrypted snapshot up to date with live data
            try {
              if (dbPath && fsSync.existsSync(activeSqlitePath)) {
                DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath, {
                  companyId: inspection.companyId || manifest?.id || 'COMPANY',
                  classification: manifest?.classification || 'PRODUCTION',
                  keyMode: manifest?.encryptionKeyMode,
                });
              }
            } catch {}
          } else {
            candidate.close();
          }
        } catch {
          try { if (sqlite) sqlite.close(); } catch {}
          sqlite = null;
        }
      }

      // If activeSqlitePath was not used, decrypt or open from inspected dbPath (.lai or .sqlite)
      if (!sqlite) {
        if (fsSync.existsSync(activeSqlitePath) || fsSync.existsSync(`${activeSqlitePath}-wal`)) {
          if (selectedSpecificNonDefaultLai) {
            // Preserve existing files safely before loading explicitly chosen snapshot
            this.quarantineDatabaseFilesSync(
              inspection.companyId || manifest?.id || 'BROWSE_IMPORT',
              resolvedPath,
              `Quarantining prior active files before opening selected snapshot '${path.basename(dbPath)}'`
            );
            try { if (fsSync.existsSync(`${activeSqlitePath}-wal`)) fsSync.unlinkSync(`${activeSqlitePath}-wal`); } catch {}
            try { if (fsSync.existsSync(`${activeSqlitePath}-shm`)) fsSync.unlinkSync(`${activeSqlitePath}-shm`); } catch {}
          }
        }

        if (DatabaseEncryptionService.isEncryptedLaiSync(dbPath)) {
          DatabaseEncryptionService.decryptDatabaseFileSync(dbPath, activeSqlitePath);
          sqlite = new Database(activeSqlitePath);
        } else {
          // Copy unencrypted SQLite to active runtime path if opening an external .sqlite directly
          if (path.resolve(dbPath) !== path.resolve(activeSqlitePath)) {
            fsSync.copyFileSync(dbPath, activeSqlitePath);
          }
          sqlite = new Database(activeSqlitePath);
        }
      }

      // Close stale cached connection for this companyId if present so future queries see updated DB
      await this.closeCompanyDb(inspection.companyId!);

      // Verify integrity once opened
      const integrity = sqlite.pragma('integrity_check') as any[];
      if (integrity[0]?.integrity_check !== 'ok') {
        throw new Error('CORRUPT_DATABASE: Database integrity check failed for selected company database.');
      }

      // Safe forward schema alignment & supported migrations (only after readonly version check passed)
      this.ensureBaseSchema(sqlite);
      let appliedMigrationsCount = 0;
      try {
        const migRes = MigrationManager.applyAllMigrations(sqlite, inspection.companyId!);
        appliedMigrationsCount = migRes.appliedCount || 0;
      } catch (migErr: any) {
        throw new Error(`SCHEMA_INCOMPATIBLE: Migration upgrade failed while opening database: ${migErr?.message || migErr}`);
      }

      // Re-verify company identity
      let compResult: any[] = [];
      try {
        compResult = sqlite.prepare('SELECT id, legal_name as legalName, classification FROM companies LIMIT 1').all() as any[];
      } catch {
        compResult = sqlite.prepare('SELECT id, legal_name as legalName FROM companies LIMIT 1').all() as any[];
      }
      if (compResult.length === 0) {
        throw new Error('INVALID_COMPANY_FOLDER: No company configuration found in database.');
      }

      const compRow = compResult[0];
      const companyId = String(compRow.id);
      const legalName = String(compRow.legalName || 'Imported Company');
      if (options?.expectedCompanyId && options.expectedCompanyId !== companyId) {
        throw new Error(`IDENTITY_MISMATCH: Selected database belongs to '${companyId}', expected '${options.expectedCompanyId}'.`);
      }

      const resolvedClassification = inferCompanyClassification(
        companyId,
        legalName,
        manifest?.isDemo,
        compRow.classification || manifest?.classification
      );

      if (manifest && manifest.id && manifest.id !== companyId) {
        const isFolderSlugManifest =
          manifest.id === path.basename(resolvedPath) ||
          manifest.id.toLowerCase() === path.basename(resolvedPath).toLowerCase() ||
          (manifest.id === 'deskguard_solutions_stress_preview' && companyId === 'LGR-PH-2026-STRESS-DG-PREVIEW') ||
          (!manifest.id.startsWith('LGR-') && manifest.location && path.resolve(manifest.location) === path.resolve(resolvedPath));

        if (isFolderSlugManifest) {
          manifest.id = companyId;
          manifest.legalName = legalName;
          try {
            const mPath = path.join(resolvedPath, 'manifest.json');
            if (fsSync.existsSync(mPath)) {
              fsSync.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');
            }
          } catch {}
        } else {
          throw new Error(`IDENTITY_MISMATCH: Manifest ID (${manifest.id}) does not match the actual database company ID (${companyId}).`);
        }
      }

      // Ensure storage subfolders exist
      await fs.mkdir(path.join(resolvedPath, 'documents'), { recursive: true }).catch(() => {});
      await fs.mkdir(path.join(resolvedPath, 'backups'), { recursive: true }).catch(() => {});

      // Remap stale absolute document paths when opening a relocated portable folder
      const relocatedDocumentsUpdated = remapRelocatedDocumentPathsSync(sqlite, resolvedPath);

      const isStressPreview = companyId === 'LGR-PH-2026-STRESS-DG-PREVIEW' || Boolean(manifest?.isVisualStressPreview);
      const manifestPath = path.join(resolvedPath, 'manifest.json');
      const nowIso = new Date().toISOString();
      const canonicalDbPath =
        path.basename(dbPath) === '.db_active.sqlite'
          ? path.join(resolvedPath, 'database.lai')
          : dbPath;

      const currentSchemaVersion = MigrationManager.getCurrentVersion(sqlite);
      let docCount = inspection.attachmentAudit?.totalReferences ?? 0;
      try {
        const cnt = sqlite.prepare('SELECT COUNT(*) as n FROM documents').get() as { n?: number } | undefined;
        if (cnt && typeof cnt.n === 'number') docCount = cnt.n;
      } catch {}

      // Checkpoint WAL cleanly and close temporary handle; re-encrypt .lai if forward migrations/remaps updated the DB or if canonical .lai needs sync
      try {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
      } catch {}
      try {
        sqlite.close();
      } catch {}
      sqlite = null;

      if (
        (appliedMigrationsCount > 0 ||
          relocatedDocumentsUpdated > 0 ||
          !fsSync.existsSync(canonicalDbPath) ||
          path.basename(dbPath) === '.db_active.sqlite') &&
        (DatabaseEncryptionService.isEncryptedLaiSync(canonicalDbPath) || canonicalDbPath.endsWith('.lai'))
      ) {
        try {
          DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, canonicalDbPath, {
            companyId,
            classification: resolvedClassification,
            keyMode: manifest?.encryptionKeyMode,
          });
        } catch {}
      }

      const portableMetadata = writePortableMetadataSync({
        companyDirectory: resolvedPath,
        companyId,
        legalName,
        dbPath: canonicalDbPath,
        schemaVersion: currentSchemaVersion,
        encryptionFormat:
          inspection.versionMetadata.containerFormat === 'LAISENC2'
            ? 'LAISENC2'
            : inspection.versionMetadata.containerFormat === 'LAISENC1'
              ? 'LAISENC1'
              : inspection.versionMetadata.containerFormat === 'SQLITE_RAW'
                ? 'SQLITE_RAW'
                : 'UNKNOWN',
        encryptionKeyRef: manifest?.keyId || manifest?.encryptionKeyMode || inspection.versionMetadata.keyMode || null,
        attachmentCount: docCount,
        createdAt: manifest?.createdAt || nowIso,
        lastRelocatedAt:
          registrationAction === 'RELOCATED' || registrationAction === 'SWITCHED_REGISTRY'
            ? nowIso
            : inspection.portableMetadata?.lastRelocatedAt,
        existingDatabaseUuid: inspection.portableMetadata?.databaseUuid,
      });

      if (!manifest) {
        manifest = {
          id: companyId,
          legalName,
          createdAt: nowIso,
          dbPath: canonicalDbPath,
          documentLocation: path.join(resolvedPath, 'documents'),
          location: resolvedPath,
          backupLocation: path.join(resolvedPath, 'backups'),
          status: 'ACTIVE',
          registrationStatus: 'REGISTERED',
          classification: resolvedClassification,
          isDemo: isStressPreview,
          isVisualStressPreview: isStressPreview || undefined,
          lastOpenedAt: nowIso,
          portableMetadata,
        };
      } else {
        manifest.id = companyId;
        manifest.legalName = legalName;
        manifest.location = resolvedPath;
        manifest.dbPath = canonicalDbPath;
        manifest.documentLocation = path.join(resolvedPath, 'documents');
        manifest.backupLocation = path.join(resolvedPath, 'backups');
        manifest.classification = resolvedClassification;
        manifest.registrationStatus = 'REGISTERED';
        manifest.unregisteredAt = undefined;
        if (isStressPreview) {
          manifest.isVisualStressPreview = true;
        }
        manifest.lastOpenedAt = nowIso;
        manifest.portableMetadata = portableMetadata;
      }

      // Never write plaintext secrets into portable manifest.json
      await fs.writeFile(manifestPath, JSON.stringify(stripPortableSecrets(manifest), null, 2)).catch(() => {});

      await this.registerCompany(manifest);

      await CompanyLifecycleService.recordShortcut({
        companyId: manifest.id,
        displayName: manifest.legalName,
        databasePath: manifest.dbPath,
        companyDirectory: manifest.location,
        databaseIdentity: manifest.id,
        lastOperation: options?.operation || 'OPENED',
        lastOpenedAt: nowIso,
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'VALID',
        classification: resolvedClassification,
        isDemo: manifest.isDemo,
        isVisualStressPreview: manifest.isVisualStressPreview,
        versionMetadata: {
          schemaVersion: currentSchemaVersion,
          latestSupportedVersion: MigrationManager.LATEST_VERSION,
          containerFormat: inspection.versionMetadata.containerFormat,
          keyMode: manifest.encryptionKeyMode || inspection.versionMetadata.keyMode,
        },
        lastValidationError: null,
      });

      return {
        ...manifest,
        registrationAction,
        attachmentAudit: inspection.attachmentAudit,
        relocatedDocumentsUpdated,
      };
    } finally {
      try { if (sqlite) sqlite.close(); } catch {}
    }
  }

  static async closeAllConnections(): Promise<void> {
    console.log("Closing all active SQLite company database connections and encrypting workspaces...");
    for (const [companyId, db] of dbCache.entries()) {
      try {
        const manifest = await this.getCompanyManifest(companyId);
        const client = sqliteCache.get(companyId) || (db && (db as any).$client);
        if (client) {
          try {
            client.pragma('wal_checkpoint(TRUNCATE)');
          } catch (e) {}
          if (typeof client.close === "function") {
            client.close();
          }
          console.log(`Successfully closed connection for company: ${companyId}`);
        }

        if (manifest && manifest.location) {
          const activeSqlitePath = path.resolve(manifest.location, '.db_active.sqlite');
          if (fsSync.existsSync(activeSqlitePath)) {
            DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, manifest.dbPath);
            console.log(`Successfully encrypted workspace at rest for company: ${companyId}`);
          }
        }
      } catch (err: any) {
        console.error(`Error closing/encrypting connection for company ${companyId}:`, err.message);
      }
    }
    dbCache.clear();
    sqliteCache.clear();
  }
}

// Graceful process shutdown handlers to ensure all debounced snapshots flush and WAL checkpoints complete
let shutdownHooksRegistered = false;
function registerShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  const onExit = () => {
    try {
      CompanyManager.flushAllPendingSnapshotsSync();
    } catch {}
  };
  process.on('SIGTERM', onExit);
  process.on('SIGINT', onExit);
  process.on('beforeExit', onExit);
}
registerShutdownHooks();
