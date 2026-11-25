import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { paths } from './paths';
import {
  CompanyManager,
  CompanyManifest,
  CompanyClassification,
  inferCompanyClassification,
  isProtectedCompanyClassification,
  isSyntheticCompanyClassification,
  RESERVED_PROTECTED_COMPANY_IDS,
} from './companyManager';
import { DatabaseEncryptionService, EncryptionKeyMode } from './databaseEncryptionService';
import { MigrationManager } from './migrationManager';
import {
  PortableAttachmentAudit,
  PortablePackageMetadata,
  auditPortableAttachmentsSync,
  inspectPortableMetadataFilesSync,
} from './portableCompanyService';

export type ShortcutOperation = 'CREATED' | 'OPENED' | 'RESTORED';

export type ShortcutAvailabilityStatus =
  | 'AVAILABLE'
  | 'MISSING'
  | 'MOVED'
  | 'INACCESSIBLE';

export type ShortcutValidationStatus =
  | 'VALID'
  | 'INVALID'
  | 'CORRUPTED'
  | 'VERSION_INCOMPATIBLE'
  | 'KEY_MISMATCH'
  | 'IDENTITY_MISMATCH'
  | 'BACKUP_FILE'
  | 'UNVERIFIED';

export interface ShortcutVersionMetadata {
  schemaVersion: number | null;
  latestSupportedVersion: number;
  containerFormat: 'LAISENC1' | 'LAISENC2' | 'SQLITE_RAW' | 'BACKUP_ARCHIVE' | 'UNKNOWN';
  keyMode?: EncryptionKeyMode | string;
}

export interface ShortcutHistoryEntry {
  companyId: string;
  displayName: string;
  databasePath: string;
  companyDirectory: string;
  databaseIdentity: string;
  lastOpenedAt: string;
  lastOperation: ShortcutOperation;
  availabilityStatus: ShortcutAvailabilityStatus;
  validationStatus: ShortcutValidationStatus;
  classification: CompanyClassification;
  isDemo?: boolean;
  isVisualStressPreview?: boolean;
  versionMetadata: ShortcutVersionMetadata;
  lastValidationError?: string | null;
  lastCheckedAt: string;
}

export interface DatabaseInspectionResult {
  valid: boolean;
  errorCode?:
    | 'DATABASE_NOT_FOUND'
    | 'FOLDER_NOT_ACCESSIBLE'
    | 'BACKUP_FILE_NOT_WORKSPACE'
    | 'INVALID_DATABASE_FORMAT'
    | 'INVALID_METADATA'
    | 'INVALID_ENCRYPTION_KEY'
    | 'CORRUPT_DATABASE'
    | 'SCHEMA_INCOMPATIBLE'
    | 'IDENTITY_MISMATCH'
    | 'CROSS_TENANT_CONTAMINATION'
    | 'MISSING_REQUIRED_ATTACHMENTS';
  message: string;
  companyDirectory: string;
  databasePath: string;
  isFileSelection: boolean;
  companyId?: string;
  legalName?: string;
  classification?: CompanyClassification;
  availabilityStatus: ShortcutAvailabilityStatus;
  validationStatus: ShortcutValidationStatus;
  versionMetadata: ShortcutVersionMetadata;
  manifest?: CompanyManifest | null;
  portableMetadata?: PortablePackageMetadata | null;
  attachmentAudit?: PortableAttachmentAudit;
  needsMigration?: boolean;
}

export interface CleanStarterInspectionResult {
  valid: boolean;
  isCleanZeroData: boolean;
  errorCode?:
    | 'DATABASE_NOT_FOUND'
    | 'FOLDER_NOT_ACCESSIBLE'
    | 'INVALID_DATABASE_FORMAT'
    | 'INVALID_ENCRYPTION_KEY'
    | 'CORRUPT_DATABASE'
    | 'SCHEMA_INCOMPATIBLE'
    | 'TAMPER_DETECTED'
    | 'STARTER_CONTAINS_COMPANY_DATA'
    | 'STARTER_CONTAINS_BUSINESS_RECORDS'
    | 'CROSS_TENANT_CONTAMINATION';
  message: string;
  databasePath: string;
  containerFormat: ShortcutVersionMetadata['containerFormat'];
  schemaVersion: number | null;
  integrityOk: boolean;
  nonZeroTables: Array<{ table: string; count: number }>;
  detectedCompanyIds: string[];
}

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';

/**
 * Strips any cryptographic/recovery secrets from a CompanyManifest before returning it
 * via public API responses or storing it inside shortcut history.
 */
export function sanitizeCompanyManifestForPublic<T extends Record<string, any>>(manifest: T): Omit<T, 'recoveryKey'> {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const clone: Record<string, any> = { ...manifest };
  delete clone.recoveryKey;
  delete clone.recoveryUsedAt;
  delete clone.kek;
  delete clone.dek;
  delete clone.secret;
  delete clone.password;
  delete clone.passwordHash;
  delete clone.signedFileContent;
  return clone as Omit<T, 'recoveryKey'>;
}

export function sanitizeShortcutEntry(entry: ShortcutHistoryEntry): ShortcutHistoryEntry {
  const clean: any = { ...entry };
  delete clean.recoveryKey;
  delete clean.recoveryUsedAt;
  delete clean.kek;
  delete clean.dek;
  delete clean.secret;
  delete clean.password;
  delete clean.passwordHash;
  delete clean.signedFileContent;
  return clean as ShortcutHistoryEntry;
}

/**
 * Redacts physical server filesystem paths for remote LAN browser clients while preserving
 * full local path visibility for local standalone/desktop administrators.
 */
export function sanitizeCompanyForClient<T extends Record<string, any>>(
  entry: T,
  options: { includePhysicalPaths?: boolean } = {}
): T & { storageScope: 'LOCAL_DESKTOP' | 'SERVER_MANAGED' } {
  const clean: Record<string, any> = sanitizeCompanyManifestForPublic(entry);
  if (!options.includePhysicalPaths) {
    delete clean.dbPath;
    delete clean.location;
    delete clean.documentLocation;
    delete clean.backupLocation;
    delete clean.databasePath;
    delete clean.companyDirectory;
    clean.storageScope = 'SERVER_MANAGED';
  } else {
    clean.storageScope = 'LOCAL_DESKTOP';
  }
  return clean as T & { storageScope: 'LOCAL_DESKTOP' | 'SERVER_MANAGED' };
}

export class CompanyLifecycleService {
  private static writeQueue: Promise<any> = Promise.resolve();

  static getShortcutHistoryFilePath(): string {
    return path.join(paths.getConfigDir(), 'shortcut_history.json');
  }

  static getShortcutStateFilePath(): string {
    return path.join(paths.getConfigDir(), 'shortcut_state.json');
  }

  private static readShortcutStateSync(): {
    suppressedCompanyIds: string[];
    clearedAt?: string;
  } {
    const statePath = this.getShortcutStateFilePath();
    try {
      if (fsSync.existsSync(statePath)) {
        const parsed = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
        const ids = Array.isArray(parsed?.suppressedCompanyIds)
          ? parsed.suppressedCompanyIds.map((id: any) => String(id).trim()).filter(Boolean)
          : [];
        return {
          suppressedCompanyIds: Array.from(new Set(ids)),
          clearedAt: typeof parsed?.clearedAt === 'string' ? parsed.clearedAt : undefined,
        };
      }
    } catch {}
    return { suppressedCompanyIds: [] };
  }

  private static writeShortcutStateSync(state: {
    suppressedCompanyIds: string[];
    clearedAt?: string;
  }): void {
    const statePath = this.getShortcutStateFilePath();
    fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
    const uniqueIds = Array.from(new Set((state.suppressedCompanyIds || []).map((id) => String(id).trim()).filter(Boolean)));
    fsSync.writeFileSync(
      statePath,
      JSON.stringify({ ...state, suppressedCompanyIds: uniqueIds }, null, 2),
      'utf8'
    );
  }

  private static async withHistoryLock<T>(
    fn: (entries: ShortcutHistoryEntry[]) => Promise<{ entries: ShortcutHistoryEntry[]; result: T }>
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const historyPath = this.getShortcutHistoryFilePath();
      await fs.mkdir(path.dirname(historyPath), { recursive: true });
      const tempPath = `${historyPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

      let current: ShortcutHistoryEntry[] = [];
      try {
        if (fsSync.existsSync(historyPath)) {
          const raw = await fs.readFile(historyPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            current = parsed.map((e) => sanitizeShortcutEntry(e));
          }
        }
      } catch {
        current = [];
      }

      const { entries, result } = await fn(current);
      const sanitized = entries.map((e) => sanitizeShortcutEntry(e));
      await fs.writeFile(tempPath, JSON.stringify(sanitized, null, 2), 'utf8');
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempPath, historyPath);
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
            if (attempt >= 2) {
              try {
                await fs.unlink(historyPath);
              } catch {}
            }
          } else {
            break;
          }
        }
      }
      if (lastError) {
        try {
          await fs.copyFile(tempPath, historyPath);
          await fs.unlink(tempPath).catch(() => {});
        } catch (copyErr) {
          throw lastError || copyErr;
        }
      }
      return result;
    };

    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => {});
    return next;
  }

  /**
   * Non-mutating, readonly inspection of a workspace folder or `.lai`/`.sqlite` database file.
   * Performs header/format checks, backup-archive rejection, decryption key verification,
   * SQLite PRAGMA integrity_check, required table & migration version checks, and identity matching
   * BEFORE any write or schema mutation happens.
   */
  static async inspectDatabaseTarget(
    rawInputPath: string,
    options?: { expectedCompanyId?: string; verifyActiveRuntime?: boolean; requireAttachments?: boolean }
  ): Promise<DatabaseInspectionResult> {
    const cleanInput = String(rawInputPath || '').trim();
    const defaultMeta: ShortcutVersionMetadata = {
      schemaVersion: null,
      latestSupportedVersion: MigrationManager.LATEST_VERSION,
      containerFormat: 'UNKNOWN',
    };

    if (!cleanInput) {
      return {
        valid: false,
        errorCode: 'DATABASE_NOT_FOUND',
        message: 'Database file or workspace folder path is required.',
        companyDirectory: '',
        databasePath: '',
        isFileSelection: false,
        availabilityStatus: 'MISSING',
        validationStatus: 'INVALID',
        versionMetadata: defaultMeta,
      };
    }

    let resolvedPath = path.resolve(cleanInput);
    if (!fsSync.existsSync(resolvedPath)) {
      const relInRoot = path.join(paths.getCompaniesRootDir(), cleanInput);
      if (fsSync.existsSync(relInRoot)) {
        resolvedPath = relInRoot;
      } else {
        return {
          valid: false,
          errorCode: 'DATABASE_NOT_FOUND',
          message: `The selected database or workspace folder does not exist at '${resolvedPath}'.`,
          companyDirectory: resolvedPath,
          databasePath: resolvedPath,
          isFileSelection: false,
          availabilityStatus: 'MISSING',
          validationStatus: 'INVALID',
          versionMetadata: defaultMeta,
        };
      }
    }

    let stat: fsSync.Stats;
    try {
      stat = fsSync.statSync(resolvedPath);
    } catch (err: any) {
      return {
        valid: false,
        errorCode: 'FOLDER_NOT_ACCESSIBLE',
        message: `Cannot access path '${resolvedPath}': ${err?.message || 'Permission denied'}`,
        companyDirectory: resolvedPath,
        databasePath: resolvedPath,
        isFileSelection: false,
        availabilityStatus: 'INACCESSIBLE',
        validationStatus: 'INVALID',
        versionMetadata: defaultMeta,
      };
    }

    const isFileSelection = stat.isFile();
    const companyDirectory = isFileSelection ? path.dirname(resolvedPath) : resolvedPath;

    const metaCheck = inspectPortableMetadataFilesSync(companyDirectory);
    if (!metaCheck.valid) {
      return {
        valid: false,
        errorCode: metaCheck.errorCode || 'INVALID_METADATA',
        message: metaCheck.message || `Corrupted or invalid company metadata in '${companyDirectory}'.`,
        companyDirectory,
        databasePath: isFileSelection ? resolvedPath : path.join(companyDirectory, 'database.lai'),
        isFileSelection,
        availabilityStatus: 'AVAILABLE',
        validationStatus: metaCheck.errorCode === 'IDENTITY_MISMATCH' ? 'IDENTITY_MISMATCH' : 'INVALID',
        versionMetadata: defaultMeta,
        manifest: null,
        portableMetadata: null,
      };
    }
    const manifest: CompanyManifest | null = metaCheck.manifest;
    const portableMetadata: PortablePackageMetadata | null = metaCheck.portableMetadata;

    let databasePath = '';
    if (isFileSelection) {
      databasePath = resolvedPath;
    } else {
      const candidates = Array.from(
        new Set(
          [
            path.join(companyDirectory, 'database.lai'),
            path.join(companyDirectory, 'company.lai'),
            manifest?.dbPath &&
            path.basename(manifest.dbPath) !== '.db_active.sqlite' &&
            fsSync.existsSync(manifest.dbPath)
              ? path.resolve(manifest.dbPath)
              : '',
            path.join(companyDirectory, 'database.sqlite'),
            path.join(companyDirectory, '.db_active.sqlite'),
          ].filter(Boolean)
        )
      );

      const existingCandidates = candidates.filter((p) => {
        try {
          return fsSync.existsSync(p) && fsSync.statSync(p).isFile();
        } catch {
          return false;
        }
      });

      databasePath = existingCandidates[0] || '';

      if (!databasePath) {
        return {
          valid: false,
          errorCode: 'DATABASE_NOT_FOUND',
          message: `No LedgerAI database (.lai or .sqlite) was found inside '${companyDirectory}'.`,
          companyDirectory,
          databasePath: path.join(companyDirectory, 'database.lai'),
          isFileSelection: false,
          availabilityStatus: 'MISSING',
          validationStatus: 'INVALID',
          versionMetadata: defaultMeta,
          manifest,
        };
      }
    }

    // Read file header safely
    let fileSize = 0;
    let headerBuf = Buffer.alloc(16);
    try {
      const fStat = fsSync.statSync(databasePath);
      fileSize = fStat.size;
      if (fileSize === 0) {
        return {
          valid: false,
          errorCode: 'CORRUPT_DATABASE',
          message: `Database file '${path.basename(databasePath)}' is empty (0 bytes) and cannot be opened.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'CORRUPTED',
          versionMetadata: defaultMeta,
          manifest,
        };
      }
      const fd = fsSync.openSync(databasePath, 'r');
      try {
        const readLen = Math.min(16, fileSize);
        fsSync.readSync(fd, headerBuf, 0, readLen, 0);
      } finally {
        fsSync.closeSync(fd);
      }
    } catch (ioErr: any) {
      return {
        valid: false,
        errorCode: 'FOLDER_NOT_ACCESSIBLE',
        message: `Cannot read database file '${databasePath}': ${ioErr?.message || 'I/O error'}`,
        companyDirectory,
        databasePath,
        isFileSelection,
        availabilityStatus: 'INACCESSIBLE',
        validationStatus: 'INVALID',
        versionMetadata: defaultMeta,
        manifest,
      };
    }

    const header6 = headerBuf.subarray(0, 6).toString('ascii');
    const header8 = headerBuf.subarray(0, 8).toString('ascii');
    const header16 = headerBuf.subarray(0, 16).toString('ascii');

    // Reject portable backup archives if user tries to Open instead of Restore
    if (header6 === 'LAIPH1' || header6 === 'LGBPH1') {
      return {
        valid: false,
        errorCode: 'BACKUP_FILE_NOT_WORKSPACE',
        message:
          'This .lai file is a LedgerAI PH backup archive package (LAIPH1). Please use "Restore from Backup" to extract and restore it.',
        companyDirectory,
        databasePath,
        isFileSelection,
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'BACKUP_FILE',
        versionMetadata: {
          ...defaultMeta,
          containerFormat: 'BACKUP_ARCHIVE',
        },
        manifest,
      };
    }

    const isEncryptedContainer = header8 === 'LAISENC1' || header8 === 'LAISENC2';
    const isRawSqlite = header16 === SQLITE_HEADER_MAGIC;

    if (!isEncryptedContainer && !isRawSqlite) {
      return {
        valid: false,
        errorCode: 'INVALID_DATABASE_FORMAT',
        message: `Unrecognized database container format in '${path.basename(databasePath)}'. Expected an encrypted LedgerAI (.lai) or SQLite database.`,
        companyDirectory,
        databasePath,
        isFileSelection,
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'CORRUPTED',
        versionMetadata: defaultMeta,
        manifest,
      };
    }

    let containerMeta = isEncryptedContainer
      ? DatabaseEncryptionService.inspectContainerMetadataSync(databasePath)
      : null;

    const versionMetadata: ShortcutVersionMetadata = {
      schemaVersion: null,
      latestSupportedVersion: MigrationManager.LATEST_VERSION,
      containerFormat: isEncryptedContainer
        ? (containerMeta?.containerVersion === 'LAISENC2' ? 'LAISENC2' : 'LAISENC1')
        : 'SQLITE_RAW',
      keyMode: containerMeta?.keyMode || (isRawSqlite ? 'UNENCRYPTED_SQLITE' : 'LEGACY_DEV_KEY'),
    };

    // Decrypt to a strictly temporary readonly inspection file so we NEVER mutate the target workspace
    let tempInspectPath: string | null = null;
    let sqlitePathToInspect = databasePath;

    if (isEncryptedContainer) {
      tempInspectPath = path.join(
        os.tmpdir(),
        `lai-inspect-${process.pid}-${crypto.randomUUID().slice(0, 8)}.sqlite`
      );
      try {
        const decrypted = DatabaseEncryptionService.decryptDatabaseFileSync(databasePath, tempInspectPath);
        if (!decrypted || !fsSync.existsSync(tempInspectPath)) {
          throw new Error('Decryption produced no SQLite output.');
        }
        sqlitePathToInspect = tempInspectPath;
      } catch (decErr: any) {
        const msg = String(decErr?.message || decErr);
        const isInvalidHeader = msg.startsWith('INVALID_ENCRYPTED_DATABASE');
        return {
          valid: false,
          errorCode: isInvalidHeader ? 'CORRUPT_DATABASE' : 'INVALID_ENCRYPTION_KEY',
          message: isInvalidHeader
            ? `Encrypted workspace container is corrupted or truncated: ${msg}`
            : `Cannot unlock encrypted database '${path.basename(databasePath)}': encryption key mismatch, missing KMS/keychain key, or tampered container.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: isInvalidHeader ? 'CORRUPTED' : 'KEY_MISMATCH',
          versionMetadata,
          manifest,
        };
      }
    }

    // Readonly SQLite structural, integrity, schema, version, and identity checks
    let roSqlite: any = null;
    try {
      roSqlite = new Database(sqlitePathToInspect, { readonly: true, fileMustExist: true });

      const integrity = roSqlite.pragma('integrity_check') as Array<Record<string, any>>;
      const integrityVal = integrity?.[0] ? Object.values(integrity[0])[0] : null;
      if (integrityVal !== 'ok') {
        return {
          valid: false,
          errorCode: 'CORRUPT_DATABASE',
          message: `SQLite integrity check failed (${String(integrityVal || 'unknown error')}). Database may be corrupted.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'CORRUPTED',
          versionMetadata,
          manifest,
        };
      }

      const existingTables = new Set(
        (roSqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
          (r) => r.name
        )
      );

      const requiredCoreTables = ['companies', 'users', 'accounts', 'journal_entries', 'accounting_periods'];
      const missingTables = requiredCoreTables.filter((t) => !existingTables.has(t));
      if (missingTables.length > 0) {
        return {
          valid: false,
          errorCode: 'SCHEMA_INCOMPATIBLE',
          message: `Database schema is incompatible: missing required LedgerAI PH table(s) [${missingTables.join(', ')}].`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'INVALID',
          versionMetadata,
          manifest,
        };
      }

      let schemaVersion = 0;
      if (existingTables.has('schema_migrations_history')) {
        try {
          const maxRow = roSqlite
            .prepare("SELECT MAX(version) as maxVer FROM schema_migrations_history WHERE status = 'SUCCESS'")
            .get() as { maxVer?: number | null } | undefined;
          schemaVersion = Number(maxRow?.maxVer || 0);
        } catch {
          schemaVersion = 0;
        }
      }
      versionMetadata.schemaVersion = schemaVersion;

      if (schemaVersion > MigrationManager.LATEST_VERSION) {
        return {
          valid: false,
          errorCode: 'SCHEMA_INCOMPATIBLE',
          message: `Database schema version (v${schemaVersion}) is newer than this LedgerAI PH build supports (max v${MigrationManager.LATEST_VERSION}). Upgrade the application before opening this file.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'VERSION_INCOMPATIBLE',
          versionMetadata,
          manifest,
        };
      }

      let compRows: Array<{ id: string; legalName?: string; classification?: string }> = [];
      try {
        compRows = roSqlite
          .prepare('SELECT id, legal_name as legalName, classification FROM companies LIMIT 10')
          .all() as any[];
      } catch {
        compRows = roSqlite
          .prepare('SELECT id, legal_name as legalName FROM companies LIMIT 10')
          .all() as any[];
      }

      if (!compRows || compRows.length === 0) {
        return {
          valid: false,
          errorCode: 'SCHEMA_INCOMPATIBLE',
          message: 'Database contains no company configuration record.',
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'INVALID',
          versionMetadata,
          manifest,
        };
      }

      if (compRows.length > 1) {
        return {
          valid: false,
          errorCode: 'CROSS_TENANT_CONTAMINATION',
          message: `Cross-tenant contamination detected: database contains ${compRows.length} company profiles (${compRows.map((c) => c.id).join(', ')}). Only single-company databases are permitted.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'IDENTITY_MISMATCH',
          versionMetadata,
          manifest,
        };
      }

      const dbCompany = compRows[0];
      const dbCompanyId = String(dbCompany.id);
      const legalName = String(dbCompany.legalName || manifest?.legalName || 'LedgerAI Company');
      const resolvedClassification = inferCompanyClassification(
        dbCompanyId,
        legalName,
        manifest?.isDemo,
        dbCompany.classification || manifest?.classification
      );

      // Scan tenant-scoped operational tables to ensure zero cross-company/foreign-tenant records exist inside this SQLite DB
      const tenantScopedTables = [
        'company_users',
        'accounts',
        'customers',
        'vendors',
        'employees',
        'inventory_items',
        'fixed_assets',
        'bank_accounts',
        'sales_invoices',
        'purchase_bills',
        'customer_payments',
        'supplier_payments',
        'cash_transactions',
        'bank_reconciliations',
        'journal_entries',
        'journal_lines',
        'payroll_runs',
        'tax_filings',
        'documents',
        'audit_logs',
      ];
      for (const tbl of tenantScopedTables) {
        if (!existingTables.has(tbl)) continue;
        try {
          const cols = roSqlite.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>;
          if (!cols.some((c) => c.name === 'company_id')) continue;
          const foreignRows = roSqlite
            .prepare(
              `SELECT DISTINCT company_id as cid FROM ${tbl} WHERE company_id IS NOT NULL AND TRIM(company_id) != '' AND company_id != ? LIMIT 5`
            )
            .all(dbCompanyId) as Array<{ cid: string }>;
          if (foreignRows.length > 0) {
            return {
              valid: false,
              errorCode: 'CROSS_TENANT_CONTAMINATION',
              message: `Cross-tenant contamination detected: table '${tbl}' contains record(s) belonging to foreign company '${foreignRows.map((r) => r.cid).join(', ')}' instead of '${dbCompanyId}'.`,
              companyDirectory,
              databasePath,
              isFileSelection,
              companyId: dbCompanyId,
              legalName,
              classification: resolvedClassification,
              availabilityStatus: 'AVAILABLE',
              validationStatus: 'IDENTITY_MISMATCH',
              versionMetadata,
              manifest,
            };
          }
        } catch {}
      }

      if (manifest?.id && manifest.id !== dbCompanyId) {
        const isFolderSlugManifest =
          manifest.id === path.basename(companyDirectory) ||
          manifest.id.toLowerCase() === path.basename(companyDirectory).toLowerCase() ||
          (manifest.id === 'deskguard_solutions_stress_preview' && dbCompanyId === 'LGR-PH-2026-STRESS-DG-PREVIEW') ||
          (!manifest.id.startsWith('LGR-') && manifest.location && path.resolve(manifest.location) === path.resolve(companyDirectory));

        if (isFolderSlugManifest) {
          // Auto-reconcile folder-slug or uncanonical manifest ID to match the authoritative SQLite database record
          manifest.id = dbCompanyId;
          manifest.legalName = legalName;
          try {
            const mPath = path.join(companyDirectory, 'manifest.json');
            if (fsSync.existsSync(mPath)) {
              fsSync.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');
            }
          } catch {}
        } else {
          return {
            valid: false,
            errorCode: 'IDENTITY_MISMATCH',
            message: `Identity mismatch: workspace manifest references '${manifest.id}', but the database belongs to '${dbCompanyId}'.`,
            companyDirectory,
            databasePath,
            isFileSelection,
            companyId: dbCompanyId,
            legalName,
            classification: resolvedClassification,
            availabilityStatus: 'AVAILABLE',
            validationStatus: 'IDENTITY_MISMATCH',
            versionMetadata,
            manifest,
          };
        }
      }

      if (options?.expectedCompanyId && options.expectedCompanyId !== dbCompanyId) {
        return {
          valid: false,
          errorCode: 'IDENTITY_MISMATCH',
          message: `Selected database belongs to '${dbCompanyId}' (${legalName}), which does not match expected shortcut company '${options.expectedCompanyId}'.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          companyId: dbCompanyId,
          legalName,
          classification: resolvedClassification,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'IDENTITY_MISMATCH',
          versionMetadata,
          manifest,
        };
      }

      // If container header embedded a companyId, verify it also matches internal DB companyId
      if (containerMeta?.companyId && containerMeta.companyId !== dbCompanyId) {
        return {
          valid: false,
          errorCode: 'IDENTITY_MISMATCH',
          message: `Encrypted container identity ('${containerMeta.companyId}') does not match internal SQLite company record ('${dbCompanyId}').`,
          companyDirectory,
          databasePath,
          isFileSelection,
          companyId: dbCompanyId,
          legalName,
          classification: resolvedClassification,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'IDENTITY_MISMATCH',
          versionMetadata,
          manifest,
        };
      }

      if (portableMetadata?.companyId && portableMetadata.companyId !== dbCompanyId) {
        return {
          valid: false,
          errorCode: 'IDENTITY_MISMATCH',
          message: `Portable metadata identity ('${portableMetadata.companyId}') does not match internal SQLite company record ('${dbCompanyId}').`,
          companyDirectory,
          databasePath,
          isFileSelection,
          companyId: dbCompanyId,
          legalName,
          classification: resolvedClassification,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'IDENTITY_MISMATCH',
          versionMetadata,
          manifest,
          portableMetadata,
        };
      }

      const attachmentAudit = auditPortableAttachmentsSync(roSqlite, companyDirectory);
      if (options?.requireAttachments && attachmentAudit.missingCount > 0) {
        return {
          valid: false,
          errorCode: 'MISSING_REQUIRED_ATTACHMENTS',
          message: `Portable company folder is missing ${attachmentAudit.missingCount} of ${attachmentAudit.totalReferences} referenced document attachment(s) (e.g., '${attachmentAudit.missingFiles[0]?.fileName || 'unknown'}'). Ensure the entire 'documents/' folder was copied together with the database.`,
          companyDirectory,
          databasePath,
          isFileSelection,
          companyId: dbCompanyId,
          legalName,
          classification: resolvedClassification,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'INVALID',
          versionMetadata,
          manifest,
          portableMetadata,
          attachmentAudit,
        };
      }

      return {
        valid: true,
        message:
          attachmentAudit.missingCount > 0
            ? `Company database verified, with warning: ${attachmentAudit.missingCount} referenced document attachment(s) are missing from the folder.`
            : 'Company database verified and ready.',
        companyDirectory,
        databasePath,
        isFileSelection,
        companyId: dbCompanyId,
        legalName,
        classification: resolvedClassification,
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'VALID',
        versionMetadata,
        manifest,
        portableMetadata,
        attachmentAudit,
        needsMigration: schemaVersion < MigrationManager.LATEST_VERSION,
      };
    } catch (sqlErr: any) {
      const msg = String(sqlErr?.message || sqlErr);
      return {
        valid: false,
        errorCode: 'CORRUPT_DATABASE',
        message: `Failed to inspect SQLite database '${path.basename(databasePath)}': ${msg}`,
        companyDirectory,
        databasePath,
        isFileSelection,
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'CORRUPTED',
        versionMetadata,
        manifest,
      };
    } finally {
      try {
        if (roSqlite) roSqlite.close();
      } catch {}
      if (tempInspectPath) {
        try {
          if (fsSync.existsSync(tempInspectPath)) fsSync.unlinkSync(tempInspectPath);
        } catch {}
      }
    }
  }

  /**
   * Records or updates a company workspace shortcut entry in `{CONFIG_DIR}/shortcut_history.json`,
   * deduplicated by `companyId` and normalized `databasePath`, strictly stripping all secrets.
   */
  static async recordShortcut(params: {
    companyId: string;
    displayName: string;
    databasePath: string;
    companyDirectory: string;
    databaseIdentity?: string;
    lastOperation: ShortcutOperation;
    lastOpenedAt?: string;
    availabilityStatus?: ShortcutAvailabilityStatus;
    validationStatus?: ShortcutValidationStatus;
    classification?: CompanyClassification;
    isDemo?: boolean;
    isVisualStressPreview?: boolean;
    versionMetadata?: ShortcutVersionMetadata;
    lastValidationError?: string | null;
  }): Promise<ShortcutHistoryEntry> {
    const normalizedDbPath = path.resolve(params.databasePath).replace(/\\/g, '/');
    const normalizedDir = path.resolve(params.companyDirectory).replace(/\\/g, '/');
    const nowIso = new Date().toISOString();
    const classification = inferCompanyClassification(
      params.companyId,
      params.displayName,
      params.isDemo,
      params.classification
    );

    const nextEntry: ShortcutHistoryEntry = sanitizeShortcutEntry({
      companyId: params.companyId,
      displayName: params.displayName || params.companyId,
      databasePath: normalizedDbPath,
      companyDirectory: normalizedDir,
      databaseIdentity: params.databaseIdentity || params.companyId,
      lastOpenedAt: params.lastOpenedAt || nowIso,
      lastOperation: params.lastOperation,
      availabilityStatus: params.availabilityStatus || 'AVAILABLE',
      validationStatus: params.validationStatus || 'VALID',
      classification,
      isDemo: Boolean(params.isDemo),
      isVisualStressPreview: params.isVisualStressPreview || undefined,
      versionMetadata: params.versionMetadata || {
        schemaVersion: MigrationManager.LATEST_VERSION,
        latestSupportedVersion: MigrationManager.LATEST_VERSION,
        containerFormat: 'LAISENC1',
      },
      lastValidationError: params.lastValidationError ?? null,
      lastCheckedAt: nowIso,
    });

    return this.withHistoryLock(async (entries) => {
      // Un-suppress this companyId so explicit Create / Open / Locate / Restore makes its shortcut visible again
      const currentState = this.readShortcutStateSync();
      if (currentState.suppressedCompanyIds.includes(nextEntry.companyId)) {
        this.writeShortcutStateSync({
          ...currentState,
          suppressedCompanyIds: currentState.suppressedCompanyIds.filter((id) => id !== nextEntry.companyId),
        });
      }

      const filtered = entries.filter(
        (e) =>
          e.companyId !== nextEntry.companyId &&
          path.resolve(e.databasePath).replace(/\\/g, '/') !== normalizedDbPath
      );
      filtered.unshift(nextEntry);
      filtered.sort(
        (a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime()
      );
      return { entries: filtered, result: nextEntry };
    });
  }

  /**
   * Evaluates live on-disk availability and validation status of a shortcut entry.
   * Never trusts cached status as proof of database validity.
   */
  static async evaluateShortcutHealth(entry: ShortcutHistoryEntry): Promise<ShortcutHistoryEntry> {
    const inspected = await this.inspectDatabaseTarget(entry.databasePath || entry.companyDirectory, {
      expectedCompanyId: entry.companyId,
    });

    // If exact databasePath disappeared, check if directory still contains a valid DB file
    let finalInspection = inspected;
    if (!inspected.valid && inspected.errorCode === 'DATABASE_NOT_FOUND' && entry.companyDirectory) {
      if (fsSync.existsSync(entry.companyDirectory)) {
        const dirCheck = await this.inspectDatabaseTarget(entry.companyDirectory, {
          expectedCompanyId: entry.companyId,
        });
        if (dirCheck.valid || dirCheck.errorCode !== 'DATABASE_NOT_FOUND') {
          finalInspection = dirCheck;
        }
      }
    }

    const updated: ShortcutHistoryEntry = sanitizeShortcutEntry({
      ...entry,
      displayName: finalInspection.legalName || entry.displayName,
      availabilityStatus: finalInspection.availabilityStatus,
      validationStatus: finalInspection.validationStatus,
      versionMetadata: finalInspection.versionMetadata,
      lastValidationError: finalInspection.valid ? null : finalInspection.message,
      lastCheckedAt: new Date().toISOString(),
    });

    return updated;
  }

  /**
   * Lists persistent shortcuts, synchronizing with registered non-synthetic (or explicitly permitted synthetic)
   * companies and evaluating live health when `verifyLive !== false`.
   */
  static async listShortcuts(options?: {
    includeSynthetic?: boolean;
    verifyLive?: boolean;
  }): Promise<ShortcutHistoryEntry[]> {
    const includeSynthetic = Boolean(options?.includeSynthetic);
    const verifyLive = options?.verifyLive !== false;

    const historyPath = this.getShortcutHistoryFilePath();
    let stored: ShortcutHistoryEntry[] = [];
    try {
      if (fsSync.existsSync(historyPath)) {
        const raw = await fs.readFile(historyPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          stored = parsed.map((e) => sanitizeShortcutEntry(e));
        }
      }
    } catch {
      stored = [];
    }

    // Strictly respect the server's mapped shortcut state: companies not recorded as shortcuts are not mapped.
    const shortcutState = this.readShortcutStateSync();
    const suppressedIds = new Set(shortcutState.suppressedCompanyIds);
    stored = stored.filter((s) => !suppressedIds.has(s.companyId));

    // Filter out synthetic companies unless explicitly authorized
    let visible = stored.filter((e) => {
      const cls = inferCompanyClassification(e.companyId, e.displayName, e.isDemo, e.classification);
      e.classification = cls;
      if (includeSynthetic) return true;
      return !isSyntheticCompanyClassification(cls) || e.isVisualStressPreview === true;
    });

    if (verifyLive) {
      const evaluated = await Promise.all(visible.map((e) => this.evaluateShortcutHealth(e)));
      visible = evaluated;
      // Persist refreshed status without altering lastOpenedAt or dropping invisible synthetic entries
      await this.withHistoryLock(async (current) => {
        const byId = new Map(evaluated.map((e) => [e.companyId, e]));
        const merged = current.map((e) => byId.get(e.companyId) || e);
        for (const e of evaluated) {
          if (!merged.some((m) => m.companyId === e.companyId)) {
            merged.push(e);
          }
        }
        merged.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
        return { entries: merged, result: undefined };
      }).catch(() => {});
    }

    visible.sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
    return visible.map((e) => sanitizeShortcutEntry(e));
  }

  /**
   * Reopens a company from shortcut history, performing live validation, closing unrelated
   * cached company DB handles, refreshing registry + lastOpenedAt, and returning sanitized profile + health.
   */
  static async reopenCompanyShortcut(
    companyId: string,
    options?: { allowSynthetic?: boolean }
  ): Promise<{ company: Omit<CompanyManifest, 'recoveryKey'>; shortcut: ShortcutHistoryEntry; inspection: DatabaseInspectionResult }> {
    const cleanId = String(companyId || '').trim();
    const history = await this.listShortcuts({ includeSynthetic: true, verifyLive: false });
    const entry = history.find((e) => e.companyId === cleanId);
    const manifest = await CompanyManager.getCompanyManifest(cleanId);

    const targetPath = entry?.databasePath || manifest?.dbPath || entry?.companyDirectory || manifest?.location;
    if (!targetPath) {
      throw new Error(`SHORTCUT_NOT_FOUND: No shortcut or registered workspace found for company '${cleanId}'.`);
    }

    const cls = inferCompanyClassification(
      cleanId,
      entry?.displayName || manifest?.legalName,
      entry?.isDemo ?? manifest?.isDemo,
      entry?.classification || manifest?.classification
    );
    if (isSyntheticCompanyClassification(cls) && !options?.allowSynthetic && !(entry?.isVisualStressPreview || manifest?.isVisualStressPreview)) {
      throw new Error(`SYNTHETIC_COMPANY_ISOLATED: Company '${cleanId}' (${cls}) requires authorized administrative access.`);
    }

    const inspection = await this.inspectDatabaseTarget(targetPath, { expectedCompanyId: cleanId });
    if (!inspection.valid) {
      await this.recordShortcut({
        companyId: cleanId,
        displayName: entry?.displayName || manifest?.legalName || cleanId,
        databasePath: inspection.databasePath || targetPath,
        companyDirectory: inspection.companyDirectory || entry?.companyDirectory || path.dirname(targetPath),
        lastOperation: entry?.lastOperation || 'OPENED',
        lastOpenedAt: entry?.lastOpenedAt,
        availabilityStatus: inspection.availabilityStatus,
        validationStatus: inspection.validationStatus,
        classification: cls,
        isDemo: entry?.isDemo ?? manifest?.isDemo,
        isVisualStressPreview: entry?.isVisualStressPreview ?? manifest?.isVisualStressPreview,
        versionMetadata: inspection.versionMetadata,
        lastValidationError: inspection.message,
      });
      throw new Error(`${inspection.errorCode || 'DATABASE_VALIDATION_FAILED'}: ${inspection.message}`);
    }

    // Multi-user safe idle-only cleanup (never closes active companies used by other LAN workstations)
    await CompanyManager.closeOtherCompanyDbs(cleanId, { force: false });

    // Register / refresh via hardened folder & DB opener (applies supported migrations if needed)
    const reopenedManifest = await CompanyManager.browseAndRegisterCompanyFolder(inspection.databasePath, {
      expectedCompanyId: cleanId,
      operation: 'OPENED',
    });

    const shortcut = await this.recordShortcut({
      companyId: reopenedManifest.id,
      displayName: reopenedManifest.legalName,
      databasePath: reopenedManifest.dbPath,
      companyDirectory: reopenedManifest.location,
      databaseIdentity: reopenedManifest.id,
      lastOperation: 'OPENED',
      lastOpenedAt: reopenedManifest.lastOpenedAt || new Date().toISOString(),
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: reopenedManifest.classification,
      isDemo: reopenedManifest.isDemo,
      isVisualStressPreview: reopenedManifest.isVisualStressPreview,
      versionMetadata: {
        ...inspection.versionMetadata,
        schemaVersion: MigrationManager.LATEST_VERSION,
      },
      lastValidationError: null,
    });

    return {
      company: sanitizeCompanyManifestForPublic(reopenedManifest),
      shortcut,
      inspection,
    };
  }

  /**
   * Relinks a MISSING or MOVED shortcut to a user-selected database file or folder,
   * strictly enforcing that the relocated database matches the expected `companyId`.
   */
  static async locateCompanyShortcut(
    companyId: string,
    newPath: string
  ): Promise<{ company: Omit<CompanyManifest, 'recoveryKey'>; shortcut: ShortcutHistoryEntry }> {
    const cleanId = String(companyId || '').trim();
    if (!cleanId || !newPath?.trim()) {
      throw new Error('VALIDATION_ERROR: companyId and newPath are required to locate a moved database.');
    }

    const inspection = await this.inspectDatabaseTarget(newPath.trim(), { expectedCompanyId: cleanId });
    if (!inspection.valid) {
      throw new Error(`${inspection.errorCode || 'LOCATE_VALIDATION_FAILED'}: ${inspection.message}`);
    }

    await CompanyManager.closeCompanyDb(cleanId).catch(() => {});
    const manifest = await CompanyManager.browseAndRegisterCompanyFolder(inspection.databasePath, {
      expectedCompanyId: cleanId,
      operation: 'OPENED',
    });

    const shortcut = await this.recordShortcut({
      companyId: manifest.id,
      displayName: manifest.legalName,
      databasePath: manifest.dbPath,
      companyDirectory: manifest.location,
      databaseIdentity: manifest.id,
      lastOperation: 'OPENED',
      lastOpenedAt: manifest.lastOpenedAt || new Date().toISOString(),
      availabilityStatus: 'AVAILABLE',
      validationStatus: 'VALID',
      classification: manifest.classification,
      isDemo: manifest.isDemo,
      isVisualStressPreview: manifest.isVisualStressPreview,
      versionMetadata: {
        ...inspection.versionMetadata,
        schemaVersion: MigrationManager.LATEST_VERSION,
      },
      lastValidationError: null,
    });

    return {
      company: sanitizeCompanyManifestForPublic(manifest),
      shortcut,
    };
  }

  /**
   * Non-destructively removes a shortcut from `shortcut_history.json` (and unregisters from `registry.json`
   * when permitted), NEVER deleting `.lai`, `.db_active.sqlite`, documents, backups, or audit files on disk.
   */
  static async removeShortcutOnly(
    companyId: string,
    options?: {
      authorizedByUserId?: string;
      confirmProtectedUnregister?: boolean;
      reason?: string;
    }
  ): Promise<{
    removed: boolean;
    companyId: string;
    filesPreserved: true;
    registryRemoved: boolean;
  }> {
    const cleanId = String(companyId || '').trim();
    if (!cleanId) {
      throw new Error('VALIDATION_ERROR: companyId is required.');
    }

    if (
      (RESERVED_PROTECTED_COMPANY_IDS.has(cleanId) ||
      RESERVED_PROTECTED_COMPANY_IDS.has(cleanId.toUpperCase())) &&
      options?.confirmProtectedUnregister !== true
    ) {
      throw new Error(
        `PROTECTED_PILOT_COMPANY: PROTECTED_COMPANY_CLASSIFICATION: Authoritative pilot company '${cleanId}' is protected from removal.`
      );
    }

    const regList = await CompanyManager.listCompanies({ includeSynthetic: true });
    const regTarget = regList.find((c) => c.id === cleanId);
    const shortcutHistoryList = await this.listShortcuts({ includeSynthetic: true, verifyLive: false });
    const historyTarget = shortcutHistoryList.find((s) => s.companyId === cleanId);
    const resolvedCls = inferCompanyClassification(
      cleanId,
      regTarget?.legalName || historyTarget?.displayName,
      regTarget?.isDemo ?? historyTarget?.isDemo,
      regTarget?.classification || historyTarget?.classification
    );
    if (isProtectedCompanyClassification(resolvedCls) && options?.confirmProtectedUnregister !== true) {
      throw new Error(
        `PROTECTED_COMPANY_CLASSIFICATION: Protected ${resolvedCls} company '${cleanId}' cannot have its shortcut removed without explicit confirmation (confirmProtectedUnregister=true).`
      );
    }

    const removedFromHistory = await this.withHistoryLock(async (entries) => {
      const exists = entries.some((e) => e.companyId === cleanId);
      const filtered = entries.filter((e) => e.companyId !== cleanId);
      return { entries: filtered, result: exists };
    });

    let registryRemoved = false;
    if (regTarget) {
      await CompanyManager.deleteCompany(cleanId, {
        confirmProtectedUnregister: options?.confirmProtectedUnregister === true,
        authorizedByUserId: options?.authorizedByUserId || 'LAUNCHER_USER',
        reason: options?.reason || 'Non-destructive shortcut removal (physical database files preserved on disk)',
      });
      registryRemoved = true;
    } else if (removedFromHistory) {
      CompanyManager.appendGovernanceAuditLogSync('SHORTCUT_REMOVED_FILES_PRESERVED', {
        companyId: cleanId,
        authorizedByUserId: options?.authorizedByUserId || 'LAUNCHER_USER',
        filesPreserved: true,
        reason: options?.reason || 'Shortcut removed from persistent shortcut history only',
      });
    }

    return {
      removed: removedFromHistory || registryRemoved,
      companyId: cleanId,
      filesPreserved: true,
      registryRemoved,
    };
  }

  /**
   * Clears ALL persistent data register / launcher shortcuts from `shortcut_history.json` ONLY.
   * NEVER deletes, modifies, or unregisters physical company databases (`.lai`, `.db_active.sqlite`,
   * backups, documents, manifests, encryption keys, or protected Pilot/Production companies).
   */
  static async clearAllShortcutsOnly(options?: {
    authorizedByUserId?: string;
    reason?: string;
    confirmClearShortcutsOnly?: boolean;
  }): Promise<{
    clearedCount: number;
    clearedCompanyIds: string[];
    filesPreserved: true;
    databaseDeleted: false;
  }> {
    if (options?.confirmClearShortcutsOnly === false) {
      throw new Error('CONFIRMATION_REQUIRED: confirmClearShortcutsOnly must be true to clear shortcuts.');
    }

    const regCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    const regIds = regCompanies.map((c) => c.id);

    const clearedCompanyIds = await this.withHistoryLock(async (entries) => {
      const existingHistoryIds = entries.map((e) => e.companyId);
      const currentState = this.readShortcutStateSync();
      const mergedSuppressed = Array.from(
        new Set([...currentState.suppressedCompanyIds, ...existingHistoryIds, ...regIds])
      );
      this.writeShortcutStateSync({
        suppressedCompanyIds: mergedSuppressed,
        clearedAt: new Date().toISOString(),
      });
      return { entries: [], result: existingHistoryIds };
    });

    CompanyManager.appendGovernanceAuditLogSync('ALL_SHORTCUTS_CLEARED_FILES_PRESERVED', {
      authorizedByUserId: options?.authorizedByUserId || 'LAUNCHER_USER',
      clearedCount: clearedCompanyIds.length,
      clearedCompanyIds,
      filesPreserved: true,
      databaseDeleted: false,
      reason:
        options?.reason ||
        'Cleared all launcher & data register shortcuts only; physical company databases and backups preserved on disk',
    });

    return {
      clearedCount: clearedCompanyIds.length,
      clearedCompanyIds,
      filesPreserved: true,
      databaseDeleted: false,
    };
  }

  /**
   * Content-based inspector for downloadable starter packages, clean starter databases,
   * and restore archives. Never trusts filename hints ('blank', 'starter', 'empty', 'clean');
   * inspects actual database tables/records, integrity, schema, encryption, and cross-tenant rows.
   */
  static async inspectCleanStarterDatabase(rawInputPath: string): Promise<CleanStarterInspectionResult> {
    const cleanInput = String(rawInputPath || '').trim();
    if (!cleanInput) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'DATABASE_NOT_FOUND',
        message: 'Database or starter package path is required.',
        databasePath: '',
        containerFormat: 'UNKNOWN',
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    }

    const resolvedPath = path.resolve(cleanInput);
    if (!fsSync.existsSync(resolvedPath)) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'DATABASE_NOT_FOUND',
        message: `Target file does not exist at '${resolvedPath}'.`,
        databasePath: resolvedPath,
        containerFormat: 'UNKNOWN',
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    }

    let stat: fsSync.Stats;
    try {
      stat = fsSync.statSync(resolvedPath);
    } catch (err: any) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'FOLDER_NOT_ACCESSIBLE',
        message: `Cannot read file '${resolvedPath}': ${err?.message || 'I/O error'}`,
        databasePath: resolvedPath,
        containerFormat: 'UNKNOWN',
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    }

    if (!stat.isFile() || stat.size === 0) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'CORRUPT_DATABASE',
        message: `Starter package '${path.basename(resolvedPath)}' is not a valid non-empty database file.`,
        databasePath: resolvedPath,
        containerFormat: 'UNKNOWN',
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    }

    const headerBuf = Buffer.alloc(16);
    const fd = fsSync.openSync(resolvedPath, 'r');
    try {
      fsSync.readSync(fd, headerBuf, 0, Math.min(16, stat.size), 0);
    } finally {
      fsSync.closeSync(fd);
    }

    const header6 = headerBuf.subarray(0, 6).toString('ascii');
    const header8 = headerBuf.subarray(0, 8).toString('ascii');
    const header16 = headerBuf.subarray(0, 16).toString('ascii');

    // 1. Backup archive inspection (LAIPH1 / LGBPH1)
    if (header6 === 'LAIPH1' || header6 === 'LGBPH1') {
      try {
        const { RestoreService } = await import('./restoreService');
        const buf = fsSync.readFileSync(resolvedPath);
        const payload = RestoreService.deserializeLai(buf);

        const nonZeroTables: Array<{ table: string; count: number }> = [];
        const detectedCompanySet = new Set<string>();

        if (payload.metadata?.companyId) {
          detectedCompanySet.add(String(payload.metadata.companyId));
        }

        const zeroRequiredKeys = [
          'companies',
          'users',
          'companyUsers',
          'customers',
          'vendors',
          'employees',
          'inventoryItems',
          'fixedAssets',
          'banks',
          'bankAccounts',
          'salesInvoices',
          'salesInvoiceLines',
          'purchaseBills',
          'purchaseBillLines',
          'customerPayments',
          'supplierPayments',
          'creditMemos',
          'debitMemos',
          'cashTransactions',
          'checks',
          'bankDeposits',
          'bankReconciliations',
          'bankStatementLines',
          'journalEntries',
          'journalLines',
          'payrollRuns',
          'payrollItems',
          'taxFilings',
          'taxCalculations',
          'electronicFilingSubmissions',
          'documents',
          'companyDocuments',
        ];

        for (const key of zeroRequiredKeys) {
          const arr = payload.data?.[key];
          if (Array.isArray(arr) && arr.length > 0) {
            nonZeroTables.push({ table: key, count: arr.length });
            for (const row of arr) {
              if (row?.companyId) detectedCompanySet.add(String(row.companyId));
              if (key === 'companies' && row?.id) detectedCompanySet.add(String(row.id));
            }
          }
        }

        const detectedCompanyIds = Array.from(detectedCompanySet);
        const hasCompanyData = (payload.data?.companies?.length || 0) > 0 || (payload.data?.users?.length || 0) > 0;
        if (nonZeroTables.length > 0 || detectedCompanyIds.length > 0) {
          return {
            valid: false,
            isCleanZeroData: false,
            errorCode: hasCompanyData ? 'STARTER_CONTAINS_COMPANY_DATA' : 'STARTER_CONTAINS_BUSINESS_RECORDS',
            message: `Starter archive rejected despite filename '${path.basename(resolvedPath)}': archive contains existing company/business data in [${nonZeroTables.map((t) => `${t.table}(${t.count})`).join(', ')}].`,
            databasePath: resolvedPath,
            containerFormat: 'BACKUP_ARCHIVE',
            schemaVersion: MigrationManager.LATEST_VERSION,
            integrityOk: true,
            nonZeroTables,
            detectedCompanyIds,
          };
        }

        return {
          valid: true,
          isCleanZeroData: true,
          message: 'Verified clean zero-data backup archive.',
          databasePath: resolvedPath,
          containerFormat: 'BACKUP_ARCHIVE',
          schemaVersion: MigrationManager.LATEST_VERSION,
          integrityOk: true,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      } catch (err: any) {
        const msg = String(err?.message || err);
        const errorCode = msg.includes('TAMPER_DETECTED')
          ? 'TAMPER_DETECTED'
          : msg.includes('CROSS_TENANT_CONTAMINATION')
          ? 'CROSS_TENANT_CONTAMINATION'
          : msg.includes('SCHEMA') || msg.includes('VERSION')
          ? 'SCHEMA_INCOMPATIBLE'
          : 'CORRUPT_DATABASE';
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode,
          message: msg,
          databasePath: resolvedPath,
          containerFormat: 'BACKUP_ARCHIVE',
          schemaVersion: null,
          integrityOk: false,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      }
    }

    // 2. Encrypted workspace container (LAISENC1 / LAISENC2) or raw SQLite inspection
    const isEncrypted = header8 === 'LAISENC1' || header8 === 'LAISENC2';
    const isRawSqlite = header16 === SQLITE_HEADER_MAGIC;
    if (!isEncrypted && !isRawSqlite) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'INVALID_DATABASE_FORMAT',
        message: `Unrecognized database format in '${path.basename(resolvedPath)}'.`,
        databasePath: resolvedPath,
        containerFormat: 'UNKNOWN',
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    }

    const containerMeta = isEncrypted
      ? DatabaseEncryptionService.inspectContainerMetadataSync(resolvedPath)
      : null;
    const containerFormat: ShortcutVersionMetadata['containerFormat'] = isEncrypted
      ? (containerMeta?.containerVersion === 'LAISENC2' ? 'LAISENC2' : 'LAISENC1')
      : 'SQLITE_RAW';

    let tempInspectPath: string | null = null;
    let sqlitePathToInspect = resolvedPath;

    if (isEncrypted) {
      tempInspectPath = path.join(
        os.tmpdir(),
        `lai-starter-${process.pid}-${crypto.randomUUID().slice(0, 8)}.sqlite`
      );
      try {
        const ok = DatabaseEncryptionService.decryptDatabaseFileSync(resolvedPath, tempInspectPath);
        if (!ok || !fsSync.existsSync(tempInspectPath)) {
          throw new Error('Decryption failed.');
        }
        sqlitePathToInspect = tempInspectPath;
      } catch (decErr: any) {
        if (tempInspectPath && fsSync.existsSync(tempInspectPath)) {
          try { fsSync.unlinkSync(tempInspectPath); } catch {}
        }
        const msg = String(decErr?.message || decErr);
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: msg.startsWith('INVALID_ENCRYPTED_DATABASE') ? 'CORRUPT_DATABASE' : 'INVALID_ENCRYPTION_KEY',
          message: `Cannot inspect encrypted starter database: ${msg}`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion: null,
          integrityOk: false,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      }
    }

    let roSqlite: any = null;
    try {
      roSqlite = new Database(sqlitePathToInspect, { readonly: true, fileMustExist: true });
      const integrity = roSqlite.pragma('integrity_check') as Array<Record<string, any>>;
      const integrityVal = integrity?.[0] ? Object.values(integrity[0])[0] : null;
      if (integrityVal !== 'ok') {
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: 'CORRUPT_DATABASE',
          message: `SQLite integrity check failed (${String(integrityVal || 'unknown')}).`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion: null,
          integrityOk: false,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      }

      const existingTables = new Set(
        (roSqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
          (r) => r.name
        )
      );
      const requiredTables = ['companies', 'users', 'accounts', 'journal_entries', 'accounting_periods'];
      const missingTables = requiredTables.filter((t) => !existingTables.has(t));
      if (missingTables.length > 0) {
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: 'SCHEMA_INCOMPATIBLE',
          message: `Starter database missing required tables: [${missingTables.join(', ')}].`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion: null,
          integrityOk: true,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      }

      let schemaVersion = 0;
      if (existingTables.has('schema_migrations_history')) {
        try {
          const maxRow = roSqlite
            .prepare("SELECT MAX(version) as maxVer FROM schema_migrations_history WHERE status = 'SUCCESS'")
            .get() as { maxVer?: number | null } | undefined;
          schemaVersion = Number(maxRow?.maxVer || 0);
        } catch {}
      }
      if (schemaVersion > MigrationManager.LATEST_VERSION) {
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: 'SCHEMA_INCOMPATIBLE',
          message: `Starter database schema v${schemaVersion} exceeds supported version v${MigrationManager.LATEST_VERSION}.`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion,
          integrityOk: true,
          nonZeroTables: [],
          detectedCompanyIds: [],
        };
      }

      const zeroRequiredSqliteTables = [
        'companies',
        'users',
        'company_users',
        'accounting_periods',
        'accounts',
        'customers',
        'vendors',
        'employees',
        'inventory_items',
        'fixed_assets',
        'banks',
        'bank_accounts',
        'sales_invoices',
        'sales_invoice_lines',
        'purchase_bills',
        'purchase_bill_lines',
        'customer_payments',
        'supplier_payments',
        'credit_memos',
        'debit_memos',
        'cash_transactions',
        'checks',
        'bank_deposits',
        'bank_reconciliations',
        'bank_statement_lines',
        'journal_entries',
        'journal_lines',
        'payroll_runs',
        'payroll_items',
        'tax_filings',
        'tax_calculations',
        'electronic_filing_submissions',
        'documents',
        'company_documents',
        'audit_logs',
      ];

      const nonZeroTables: Array<{ table: string; count: number }> = [];
      const detectedCompanySet = new Set<string>();

      for (const tbl of zeroRequiredSqliteTables) {
        if (!existingTables.has(tbl)) continue;
        try {
          const countRow = roSqlite.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).get() as { cnt: number };
          const cnt = Number(countRow?.cnt || 0);
          if (cnt > 0) {
            nonZeroTables.push({ table: tbl, count: cnt });
            if (tbl === 'companies') {
              const ids = roSqlite.prepare('SELECT id FROM companies LIMIT 10').all() as Array<{ id: string }>;
              ids.forEach((r) => r.id && detectedCompanySet.add(String(r.id)));
            } else {
              const cols = roSqlite.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>;
              if (cols.some((c) => c.name === 'company_id')) {
                const cids = roSqlite
                  .prepare(`SELECT DISTINCT company_id as cid FROM ${tbl} WHERE company_id IS NOT NULL LIMIT 10`)
                  .all() as Array<{ cid: string }>;
                cids.forEach((r) => r.cid && detectedCompanySet.add(String(r.cid)));
              }
            }
          }
        } catch {}
      }

      const detectedCompanyIds = Array.from(detectedCompanySet);
      if (detectedCompanyIds.length > 1) {
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: 'CROSS_TENANT_CONTAMINATION',
          message: `Starter database rejected: multiple company/tenant IDs found (${detectedCompanyIds.join(', ')}) inside '${path.basename(resolvedPath)}'.`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion,
          integrityOk: true,
          nonZeroTables,
          detectedCompanyIds,
        };
      }

      if (nonZeroTables.length > 0) {
        const hasCompanyOrUser = nonZeroTables.some((t) => t.table === 'companies' || t.table === 'users' || t.table === 'company_users');
        return {
          valid: false,
          isCleanZeroData: false,
          errorCode: hasCompanyOrUser ? 'STARTER_CONTAINS_COMPANY_DATA' : 'STARTER_CONTAINS_BUSINESS_RECORDS',
          message: `Clean starter check failed despite filename '${path.basename(resolvedPath)}': contains non-zero records in [${nonZeroTables.map((t) => `${t.table}(${t.count})`).join(', ')}].`,
          databasePath: resolvedPath,
          containerFormat,
          schemaVersion,
          integrityOk: true,
          nonZeroTables,
          detectedCompanyIds,
        };
      }

      return {
        valid: true,
        isCleanZeroData: true,
        message: 'Verified clean zero-data starter database (valid SQLite integrity, schema, zero companies and zero business records).',
        databasePath: resolvedPath,
        containerFormat,
        schemaVersion,
        integrityOk: true,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    } catch (sqlErr: any) {
      return {
        valid: false,
        isCleanZeroData: false,
        errorCode: 'CORRUPT_DATABASE',
        message: `Failed to inspect starter database '${path.basename(resolvedPath)}': ${String(sqlErr?.message || sqlErr)}`,
        databasePath: resolvedPath,
        containerFormat,
        schemaVersion: null,
        integrityOk: false,
        nonZeroTables: [],
        detectedCompanyIds: [],
      };
    } finally {
      try { if (roSqlite) roSqlite.close(); } catch {}
      if (tempInspectPath) {
        try { if (fsSync.existsSync(tempInspectPath)) fsSync.unlinkSync(tempInspectPath); } catch {}
      }
    }
  }
}
