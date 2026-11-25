import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { paths } from './paths';
import type { CompanyManifest } from './companyManager';

export const PORTABLE_FORMAT_VERSION = '2.0.0';
export const PORTABLE_APP_MIN_VERSION = '1.0.0';
export const PORTABLE_META_FILENAME = 'portable_meta.json';

export interface PortablePackageMetadata {
  portableFormatVersion: string;
  companyId: string;
  databaseUuid: string;
  legalName: string;
  schemaVersion: number;
  appMinVersion: string;
  relativeDbPath: string;
  relativeDocumentsDir: string;
  relativeBackupsDir: string;
  encryptionFormat: 'LAISENC1' | 'LAISENC2' | 'SQLITE_RAW' | 'UNKNOWN';
  encryptionKeyRef: string | null;
  dbChecksumSha256: string | null;
  attachmentCount: number;
  createdAt: string;
  lastSyncedAt: string;
  lastRelocatedAt?: string;
  restoredFromBackupChecksum?: string;
}

export interface PortableAttachmentAudit {
  totalReferences: number;
  presentCount: number;
  missingCount: number;
  missingFiles: Array<{
    documentId: string;
    fileName: string;
    expectedPath: string;
  }>;
}

export type DuplicateIdentityStatus =
  | 'NEW_COMPANY'
  | 'ALREADY_REGISTERED_SAME_LOCATION'
  | 'RELOCATED_ORIGINAL_MISSING'
  | 'DUPLICATE_IDENTITY_CONFLICT';

export interface DuplicateIdentityAssessment {
  status: DuplicateIdentityStatus;
  companyId: string;
  existingLocation?: string;
  selectedLocation: string;
  existingLegalName?: string;
  message: string;
}

export interface DiskSpaceCheckResult {
  sufficient: boolean;
  requiredBytes: number;
  availableBytes: number | null;
  targetDirectory: string;
  message: string;
}

export interface PortableImportFileInput {
  relativePath: string;
  base64Content: string;
}

const SECRET_KEYS_BLOCKLIST = [
  'recoveryKey',
  'recoveryUsedAt',
  'kek',
  'dek',
  'secret',
  'password',
  'passwordHash',
  'privateKey',
  'masterKey',
  'signedFileContent',
];

/**
 * Strips any secret or key material recursively before persisting portable metadata to disk.
 * Encryption keys and secrets must NEVER be stored in plaintext inside a portable package.
 */
export function stripPortableSecrets<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  const clone: Record<string, any> = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of SECRET_KEYS_BLOCKLIST) {
    if (key in clone) {
      delete clone[key];
    }
  }
  return clone as T;
}

export function normalizeComparePath(rawPath: string): string {
  return path.resolve(rawPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Computes SHA-256 hex digest of a file on disk if readable, or null if absent.
 */
export function computeFileSha256Sync(filePath: string): string | null {
  try {
    if (!filePath || !fsSync.existsSync(filePath)) return null;
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) return null;
    const buf = fsSync.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Reads and structurally validates `portable_meta.json` and `manifest.json` inside a company folder.
 * Distinguishes between "file absent" (recoverable from authoritative SQLite DB) and
 * "file present but corrupted / structurally invalid" (explicit INVALID_METADATA failure).
 */
export function inspectPortableMetadataFilesSync(companyDirectory: string): {
  valid: boolean;
  errorCode?: 'INVALID_METADATA' | 'IDENTITY_MISMATCH';
  message?: string;
  manifest: CompanyManifest | null;
  portableMetadata: PortablePackageMetadata | null;
} {
  const manifestPath = path.join(companyDirectory, 'manifest.json');
  const portableMetaPath = path.join(companyDirectory, PORTABLE_META_FILENAME);

  let manifest: CompanyManifest | null = null;
  let portableMetadata: PortablePackageMetadata | null = null;

  if (fsSync.existsSync(manifestPath)) {
    try {
      const raw = fsSync.readFileSync(manifestPath, 'utf8').trim();
      if (!raw) {
        return {
          valid: false,
          errorCode: 'INVALID_METADATA',
          message: `Company metadata file 'manifest.json' in '${companyDirectory}' is empty or corrupted.`,
          manifest: null,
          portableMetadata: null,
        };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          valid: false,
          errorCode: 'INVALID_METADATA',
          message: `Company metadata file 'manifest.json' does not contain a valid JSON object.`,
          manifest: null,
          portableMetadata: null,
        };
      }
      if (!parsed.id || typeof parsed.id !== 'string' || !parsed.id.trim()) {
        return {
          valid: false,
          errorCode: 'INVALID_METADATA',
          message: `Company metadata file 'manifest.json' is missing a valid company 'id'.`,
          manifest: null,
          portableMetadata: null,
        };
      }
      manifest = parsed as CompanyManifest;
      if (parsed.portableMetadata && typeof parsed.portableMetadata === 'object') {
        portableMetadata = parsed.portableMetadata as PortablePackageMetadata;
      }
    } catch (err: any) {
      return {
        valid: false,
        errorCode: 'INVALID_METADATA',
        message: `Company metadata file 'manifest.json' is corrupted or invalid JSON: ${err?.message || 'parse error'}`,
        manifest: null,
        portableMetadata: null,
      };
    }
  }

  if (fsSync.existsSync(portableMetaPath)) {
    try {
      const raw = fsSync.readFileSync(portableMetaPath, 'utf8').trim();
      if (!raw) {
        return {
          valid: false,
          errorCode: 'INVALID_METADATA',
          message: `Portable package metadata file '${PORTABLE_META_FILENAME}' is empty or corrupted.`,
          manifest,
          portableMetadata: null,
        };
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.companyId !== 'string' || !parsed.companyId.trim()) {
        return {
          valid: false,
          errorCode: 'INVALID_METADATA',
          message: `Portable package metadata file '${PORTABLE_META_FILENAME}' is missing required companyId metadata.`,
          manifest,
          portableMetadata: null,
        };
      }
      portableMetadata = parsed as PortablePackageMetadata;
    } catch (err: any) {
      return {
        valid: false,
        errorCode: 'INVALID_METADATA',
        message: `Portable package metadata file '${PORTABLE_META_FILENAME}' is corrupted or invalid JSON: ${err?.message || 'parse error'}`,
        manifest,
        portableMetadata: null,
      };
    }
  }

  if (manifest && portableMetadata && manifest.id && portableMetadata.companyId && manifest.id !== portableMetadata.companyId) {
    return {
      valid: false,
      errorCode: 'IDENTITY_MISMATCH',
      message: `Identity mismatch: manifest.json companyId ('${manifest.id}') does not match ${PORTABLE_META_FILENAME} ('${portableMetadata.companyId}').`,
      manifest,
      portableMetadata,
    };
  }

  return {
    valid: true,
    manifest,
    portableMetadata,
  };
}

/**
 * Writes secret-free standardized `portable_meta.json` alongside the company folder and returns the metadata object.
 * Uses relative paths so the folder remains completely self-describing across drive/computer relocations.
 */
export function writePortableMetadataSync(params: {
  companyDirectory: string;
  companyId: string;
  legalName: string;
  dbPath: string;
  schemaVersion: number;
  encryptionFormat: PortablePackageMetadata['encryptionFormat'];
  encryptionKeyRef?: string | null;
  attachmentCount?: number;
  createdAt?: string;
  lastRelocatedAt?: string;
  restoredFromBackupChecksum?: string;
  existingDatabaseUuid?: string;
}): PortablePackageMetadata {
  const { companyDirectory, companyId, legalName, dbPath } = params;
  fsSync.mkdirSync(companyDirectory, { recursive: true });

  // Preserve existing stable databaseUuid across updates/relocations
  let databaseUuid = params.existingDatabaseUuid || '';
  const metaPath = path.join(companyDirectory, PORTABLE_META_FILENAME);
  let priorMeta: Partial<PortablePackageMetadata> | null = null;
  if (fsSync.existsSync(metaPath)) {
    try {
      priorMeta = JSON.parse(fsSync.readFileSync(metaPath, 'utf8'));
      if (!databaseUuid && typeof priorMeta?.databaseUuid === 'string' && priorMeta.databaseUuid.trim()) {
        databaseUuid = priorMeta.databaseUuid.trim();
      }
    } catch {
      priorMeta = null;
    }
  }
  if (!databaseUuid) {
    databaseUuid = crypto.randomUUID();
  }

  const relDb = path.relative(companyDirectory, dbPath).replace(/\\/g, '/');
  const relativeDbPath = relDb && !relDb.startsWith('..') && !path.isAbsolute(relDb) ? relDb : path.basename(dbPath || 'database.lai');
  const nowIso = new Date().toISOString();

  const metadata: PortablePackageMetadata = stripPortableSecrets({
    portableFormatVersion: PORTABLE_FORMAT_VERSION,
    companyId,
    databaseUuid,
    legalName,
    schemaVersion: Number.isFinite(params.schemaVersion) ? params.schemaVersion : 0,
    appMinVersion: PORTABLE_APP_MIN_VERSION,
    relativeDbPath,
    relativeDocumentsDir: 'documents',
    relativeBackupsDir: 'backups',
    encryptionFormat: params.encryptionFormat || 'LAISENC1',
    encryptionKeyRef: params.encryptionKeyRef ?? priorMeta?.encryptionKeyRef ?? null,
    dbChecksumSha256: computeFileSha256Sync(dbPath),
    attachmentCount: typeof params.attachmentCount === 'number' ? params.attachmentCount : (priorMeta?.attachmentCount ?? 0),
    createdAt: params.createdAt || priorMeta?.createdAt || nowIso,
    lastSyncedAt: nowIso,
    lastRelocatedAt: params.lastRelocatedAt || priorMeta?.lastRelocatedAt,
    restoredFromBackupChecksum: params.restoredFromBackupChecksum || priorMeta?.restoredFromBackupChecksum,
  });

  const tmpPath = `${metaPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fsSync.writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), 'utf8');
  fsSync.renameSync(tmpPath, metaPath);

  return metadata;
}

/**
 * Inspects document & attachment references inside a readonly SQLite database against the
 * portable folder's `documents/` directory (supporting both exact stored paths and relocated paths).
 */
export function auditPortableAttachmentsSync(
  roSqlite: any,
  companyDirectory: string
): PortableAttachmentAudit {
  const result: PortableAttachmentAudit = {
    totalReferences: 0,
    presentCount: 0,
    missingCount: 0,
    missingFiles: [],
  };

  try {
    const hasDocsTable = roSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'")
      .get();
    if (!hasDocsTable) return result;

    const rows = roSqlite
      .prepare('SELECT id, file_name as fileName, file_path as filePath, file_hash as fileHash FROM documents')
      .all() as Array<{ id: string; fileName?: string; filePath?: string; fileHash?: string }>;

    if (!rows || rows.length === 0) return result;

    const docsRoot = path.join(companyDirectory, 'documents');
    const originalsRoot = path.join(docsRoot, 'originals');

    for (const doc of rows) {
      const hasFileRef = Boolean((doc.filePath && doc.filePath.trim()) || (doc.fileName && doc.fileName.trim()));
      if (!hasFileRef) continue;

      result.totalReferences += 1;

      const ext = path.extname(doc.fileName || doc.filePath || '');
      const baseFromPath = doc.filePath ? path.basename(doc.filePath) : '';
      const hashPrefix = doc.fileHash && doc.fileHash.length >= 4
        ? path.join(originalsRoot, doc.fileHash.slice(0, 2), doc.fileHash.slice(2, 4))
        : '';

      const candidates = Array.from(
        new Set(
          [
            // Direct stored path (if inside this relocated folder or still on same machine)
            doc.filePath && path.isAbsolute(doc.filePath) ? doc.filePath : '',
            // Relative path from company directory
            doc.filePath && !path.isAbsolute(doc.filePath) ? path.join(companyDirectory, doc.filePath) : '',
            // Relocated partitioned originals path
            hashPrefix && baseFromPath ? path.join(hashPrefix, baseFromPath) : '',
            hashPrefix ? path.join(hashPrefix, `${doc.id}${ext}`) : '',
            hashPrefix ? path.join(hashPrefix, `${doc.id}${ext}.enc`) : '',
            // Relocated flat documents/ directory candidates
            baseFromPath ? path.join(docsRoot, baseFromPath) : '',
            doc.fileName ? path.join(docsRoot, doc.fileName) : '',
            path.join(docsRoot, `${doc.id}${ext}`),
            path.join(docsRoot, `${doc.id}${ext}.enc`),
          ].filter(Boolean)
        )
      );

      const found = candidates.some((candidate) => {
        try {
          return fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile();
        } catch {
          return false;
        }
      });

      if (found) {
        result.presentCount += 1;
      } else {
        result.missingCount += 1;
        if (result.missingFiles.length < 50) {
          result.missingFiles.push({
            documentId: String(doc.id),
            fileName: String(doc.fileName || baseFromPath || doc.id),
            expectedPath: doc.filePath || path.join(docsRoot, `${doc.id}${ext}`),
          });
        }
      }
    }
  } catch {
    // Non-fatal fallback if documents schema differs on legacy DB
  }

  return result;
}

/**
 * Remaps stale absolute `documents.file_path` records after a portable company folder is relocated
 * to another drive or workstation, preserving exact file references inside `<newCompanyDirectory>/documents`.
 */
export function remapRelocatedDocumentPathsSync(sqlite: any, newCompanyDirectory: string): number {
  let updatedCount = 0;
  try {
    const hasDocsTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'")
      .get();
    if (!hasDocsTable) return 0;

    const rows = sqlite
      .prepare('SELECT id, file_name as fileName, file_path as filePath, file_hash as fileHash FROM documents')
      .all() as Array<{ id: string; fileName?: string; filePath?: string; fileHash?: string }>;

    const docsRoot = path.join(newCompanyDirectory, 'documents');
    const originalsRoot = path.join(docsRoot, 'originals');
    const normNewDir = normalizeComparePath(newCompanyDirectory);
    const updateStmt = sqlite.prepare('UPDATE documents SET file_path = ? WHERE id = ?');

    for (const doc of rows) {
      if (!doc.filePath) continue;
      // If current filePath already points inside the relocated company directory and exists, keep it
      if (
        normalizeComparePath(doc.filePath).startsWith(normNewDir + '/') &&
        fsSync.existsSync(doc.filePath)
      ) {
        continue;
      }

      const ext = path.extname(doc.fileName || doc.filePath || '');
      const base = path.basename(doc.filePath);
      const hashPrefix =
        doc.fileHash && doc.fileHash.length >= 4
          ? path.join(originalsRoot, doc.fileHash.slice(0, 2), doc.fileHash.slice(2, 4))
          : '';

      const relocatedCandidates = [
        hashPrefix ? path.join(hashPrefix, base) : '',
        hashPrefix ? path.join(hashPrefix, `${doc.id}${ext}`) : '',
        hashPrefix ? path.join(hashPrefix, `${doc.id}${ext}.enc`) : '',
        path.join(docsRoot, base),
        doc.fileName ? path.join(docsRoot, doc.fileName) : '',
        path.join(docsRoot, `${doc.id}${ext}`),
        path.join(docsRoot, `${doc.id}${ext}.enc`),
      ].filter(Boolean);

      const matched = relocatedCandidates.find((p) => {
        try {
          return fsSync.existsSync(p) && fsSync.statSync(p).isFile();
        } catch {
          return false;
        }
      });

      if (matched) {
        updateStmt.run(matched, doc.id);
        updatedCount += 1;
      }
    }
  } catch {
    // Non-fatal
  }
  return updatedCount;
}

/**
 * Pure deterministic company identity & duplicate location assessment against the authoritative Company Registry.
 * Never identifies a company by folder name alone — compares stable `companyId` and resolved on-disk locations.
 */
export function assessCompanyIdentityDuplicate(params: {
  companyId: string;
  selectedDirectory: string;
  registeredCompanies: Array<{ id: string; legalName?: string; location?: string; dbPath?: string }>;
  pathExistsFn?: (targetPath: string) => boolean;
}): DuplicateIdentityAssessment {
  const { companyId, selectedDirectory, registeredCompanies } = params;
  const existsCheck = params.pathExistsFn || ((p: string) => fsSync.existsSync(p));
  const normSelected = normalizeComparePath(selectedDirectory);

  const existing = registeredCompanies.find((c) => c.id === companyId);
  if (!existing) {
    return {
      status: 'NEW_COMPANY',
      companyId,
      selectedLocation: path.resolve(selectedDirectory),
      message: `Company '${companyId}' is not yet registered and can be registered cleanly.`,
    };
  }

  const existingDir = existing.location || (existing.dbPath ? path.dirname(existing.dbPath) : '');
  const normExisting = existingDir ? normalizeComparePath(existingDir) : '';

  if (normExisting && normExisting === normSelected) {
    return {
      status: 'ALREADY_REGISTERED_SAME_LOCATION',
      companyId,
      existingLocation: path.resolve(existingDir),
      selectedLocation: path.resolve(selectedDirectory),
      existingLegalName: existing.legalName,
      message: `Company '${existing.legalName || companyId}' is already registered at this location. Reusing existing registry entry.`,
    };
  }

  // Different folder for the same companyId — check if the previously registered DB still exists on disk
  const existingDbCandidates = existingDir
    ? [
        existing.dbPath || '',
        path.join(existingDir, 'database.lai'),
        path.join(existingDir, '.db_active.sqlite'),
        path.join(existingDir, 'database.sqlite'),
      ].filter(Boolean)
    : [];
  const originalStillPresent = existingDbCandidates.some((p) => existsCheck(p));

  if (!originalStillPresent) {
    return {
      status: 'RELOCATED_ORIGINAL_MISSING',
      companyId,
      existingLocation: existingDir ? path.resolve(existingDir) : undefined,
      selectedLocation: path.resolve(selectedDirectory),
      existingLegalName: existing.legalName,
      message: `Relocated company '${existing.legalName || companyId}' detected. Prior location '${existingDir}' is no longer present; updating registry pointer to '${path.resolve(selectedDirectory)}'.`,
    };
  }

  return {
    status: 'DUPLICATE_IDENTITY_CONFLICT',
    companyId,
    existingLocation: path.resolve(existingDir),
    selectedLocation: path.resolve(selectedDirectory),
    existingLegalName: existing.legalName,
    message: `DUPLICATE_COMPANY_IDENTITY_CONFLICT: Company '${existing.legalName || companyId}' (${companyId}) is already registered at '${path.resolve(existingDir)}' and both databases exist on disk. Choose explicitly whether to keep the existing registered folder or switch the registry pointer to '${path.resolve(selectedDirectory)}'.`,
  };
}

/**
 * Verifies available destination disk storage before extracting or reconstructing a company database.
 * Supports `availableBytesOverride` for deterministic unit/regression testing.
 */
export async function verifyDestinationDiskSpace(
  targetDirectory: string,
  requiredBytes: number,
  availableBytesOverride?: number | null
): Promise<DiskSpaceCheckResult> {
  const safeRequired = Math.max(0, Math.floor(requiredBytes));
  let probeDir = path.resolve(targetDirectory);

  // Walk upward to the nearest existing ancestor directory without creating anything on disk
  while (!fsSync.existsSync(probeDir)) {
    const parent = path.dirname(probeDir);
    if (!parent || parent === probeDir) break;
    probeDir = parent;
  }

  let availableBytes: number | null =
    typeof availableBytesOverride === 'number' && Number.isFinite(availableBytesOverride)
      ? availableBytesOverride
      : null;

  if (availableBytes === null && typeof (fs as any).statfs === 'function') {
    try {
      const stats = await (fs as any).statfs(probeDir);
      if (stats && typeof stats.bavail === 'number' && typeof stats.bsize === 'number') {
        availableBytes = stats.bavail * stats.bsize;
      }
    } catch {
      availableBytes = null;
    }
  }

  if (availableBytes !== null && availableBytes < safeRequired) {
    const reqMb = (safeRequired / (1024 * 1024)).toFixed(2);
    const availMb = (availableBytes / (1024 * 1024)).toFixed(2);
    return {
      sufficient: false,
      requiredBytes: safeRequired,
      availableBytes,
      targetDirectory: path.resolve(targetDirectory),
      message: `INSUFFICIENT_DESTINATION_STORAGE: Destination drive has ${availMb} MB available, but at least ${reqMb} MB is required to safely extract and reconstruct the company database.`,
    };
  }

  return {
    sufficient: true,
    requiredBytes: safeRequired,
    availableBytes,
    targetDirectory: path.resolve(targetDirectory),
    message: 'Sufficient destination storage verified.',
  };
}

/**
 * Sanitizes and validates a relative path inside an uploaded portable package (Centralized Server Mode).
 * Prevents path traversal (Zip-Slip), absolute paths, null bytes, and dangerous script files.
 */
export function sanitizePortableImportRelativePath(rawRelPath: string): { valid: boolean; safeRelPath?: string; reason?: string } {
  if (!rawRelPath || typeof rawRelPath !== 'string') {
    return { valid: false, reason: 'Empty file path in portable package upload.' };
  }
  if (rawRelPath.includes('\0')) {
    return { valid: false, reason: 'Null byte detected in uploaded package path.' };
  }

  const normalized = rawRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { valid: false, reason: 'Invalid empty relative path.' };
  }
  if (segments.some((s) => s === '..' || s === '.' || s.includes(':'))) {
    return { valid: false, reason: `Path traversal or invalid segment blocked in '${rawRelPath}'.` };
  }

  // Strip optional single top-level folder prefix (e.g., "ABC_Trading/database.lai" -> "database.lai")
  let effectiveSegments = segments;
  if (
    segments.length >= 2 &&
    !['documents', 'backups'].includes(segments[0].toLowerCase())
  ) {
    const second = segments[1].toLowerCase();
    if (
      ['database.lai', 'company.lai', 'database.sqlite', 'manifest.json', PORTABLE_META_FILENAME, 'documents', 'backups'].includes(second)
    ) {
      effectiveSegments = segments.slice(1);
    }
  }

  const top = effectiveSegments[0].toLowerCase();
  const allowedRootFiles = new Set(['database.lai', 'company.lai', 'database.sqlite', 'manifest.json', PORTABLE_META_FILENAME]);
  const allowedSubdirs = new Set(['documents', 'backups']);

  if (effectiveSegments.length === 1) {
    if (!allowedRootFiles.has(top)) {
      return { valid: false, reason: `File '${effectiveSegments[0]}' is not an allowed portable company package root file.` };
    }
  } else if (!allowedSubdirs.has(top)) {
    return { valid: false, reason: `Subdirectory '${effectiveSegments[0]}' is not permitted in portable package import.` };
  }

  const ext = path.extname(effectiveSegments[effectiveSegments.length - 1]).toLowerCase();
  const blockedExts = new Set(['.exe', '.bat', '.cmd', '.ps1', '.sh', '.vbs', '.msi', '.dll', '.com', '.scr']);
  if (blockedExts.has(ext)) {
    return { valid: false, reason: `Executable file extension '${ext}' is blocked in portable package import.` };
  }

  return { valid: true, safeRelPath: effectiveSegments.join('/') };
}

/**
 * Stages an uploaded portable company package (from a remote browser client in Centralized Server Mode)
 * into a temporary isolated staging folder, strictly sanitizing every path before inspection.
 */
export async function stageUploadedPortablePackage(
  files: PortableImportFileInput[]
): Promise<{ stagingDir: string; fileCount: number; totalBytes: number }> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('BAD_REQUEST: Portable package import requires at least a valid company database file (database.lai).');
  }

  const tempRoot = path.join(paths.getConfigDir(), 'temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const stagingDir = await fs.mkdtemp(path.join(tempRoot, 'portable-import-'));

  let fileCount = 0;
  let totalBytes = 0;
  const MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150 MB guard for inline JSON/base64 import

  try {
    for (const item of files) {
      const pathCheck = sanitizePortableImportRelativePath(item?.relativePath || '');
      if (!pathCheck.valid || !pathCheck.safeRelPath) {
        throw new Error(`PATH_TRAVERSAL_BLOCKED: ${pathCheck.reason || 'Invalid path in portable package.'}`);
      }

      const rawInput =
        typeof item.base64Content === 'string'
          ? item.base64Content
          : typeof (item as any).contentBase64 === 'string'
            ? (item as any).contentBase64
            : '';
      const rawBase64 = rawInput.includes('base64,') ? rawInput.split('base64,')[1] : rawInput;
      const buf = Buffer.from(rawBase64, 'base64');
      totalBytes += buf.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('PACKAGE_TOO_LARGE: Uploaded portable package exceeds maximum server import size (150 MB).');
      }

      const destPath = path.resolve(stagingDir, pathCheck.safeRelPath);
      const rel = path.relative(stagingDir, destPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('PATH_TRAVERSAL_BLOCKED: Resolved destination escaped staging directory.');
      }

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, buf);
      fileCount += 1;
    }

    return { stagingDir, fileCount, totalBytes };
  } catch (err) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Safely copies a directory tree (used when moving a validated staged portable package into
 * authorized central server company storage).
 */
export async function copyDirectoryRecursive(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
    }
  }
}
