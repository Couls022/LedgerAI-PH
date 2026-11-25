import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import crypto from 'crypto';
import { CompanyManager } from './companyManager';
import { DocumentEncryptionService, DocumentAadMetadata } from './documentEncryptionService';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';

export type StorageTier = 'originals' | 'thumbnails' | 'previews' | 'processed' | 'quarantine' | 'temp';

export class CompanyStorageService {
  private static companyRootCache = new Map<string, { root: string; expiresAt: number }>();
  private static ensuredDirs = new Set<string>();

  static clearStorageCache(companyId?: string): void {
    if (companyId) {
      this.companyRootCache.delete(companyId);
    } else {
      this.companyRootCache.clear();
      this.ensuredDirs.clear();
    }
  }

  private static async ensureDirFast(dirPath: string): Promise<void> {
    if (this.ensuredDirs.has(dirPath) && fsSync.existsSync(dirPath)) {
      return;
    }
    await fs.mkdir(dirPath, { recursive: true });
    this.ensuredDirs.add(dirPath);
  }

  static async getCompanyRoot(companyId: string): Promise<string> {
    const now = Date.now();
    const cached = this.companyRootCache.get(companyId);
    if (cached && cached.expiresAt > now && fsSync.existsSync(cached.root)) {
      return cached.root;
    }
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    this.companyRootCache.set(companyId, { root: manifest.location, expiresAt: now + 5000 });
    return manifest.location;
  }

  static async getDocumentsPath(companyId: string): Promise<string> {
    const root = await this.getCompanyRoot(companyId);
    const docsPath = path.join(root, 'documents');
    await this.ensureDirFast(docsPath);
    return docsPath;
  }

  static async getStorageTierPath(companyId: string, tier: StorageTier): Promise<string> {
    const docsRoot = await this.getDocumentsPath(companyId);
    const tierPath = path.join(docsRoot, tier);
    await this.ensureDirFast(tierPath);
    return tierPath;
  }

  static async getOriginalsPath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'originals');
  }

  static async getThumbnailsPath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'thumbnails');
  }

  static async getPreviewsPath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'previews');
  }

  static async getProcessedPath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'processed');
  }

  static async getQuarantinePath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'quarantine');
  }

  static async getTempPath(companyId: string): Promise<string> {
    return this.getStorageTierPath(companyId, 'temp');
  }

  static async getTempFilePath(companyId: string, filename: string): Promise<string> {
    const tempRoot = await this.getTempPath(companyId);
    const cleanName = path.basename(filename);
    const target = path.join(tempRoot, cleanName);
    return this.assertPathInsideCompany(companyId, target);
  }

  static async getBackupsPath(companyId: string): Promise<string> {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    const backupsPath = manifest.backupLocation || path.join(manifest.location, 'backups');
    await fs.mkdir(backupsPath, { recursive: true });
    return backupsPath;
  }

  static async getExportsPath(companyId: string): Promise<string> {
    const root = await this.getCompanyRoot(companyId);
    const exportsPath = path.join(root, 'exports');
    await fs.mkdir(exportsPath, { recursive: true });
    return exportsPath;
  }

  /**
   * Asserts that a target file path strictly resides within the authorized company workspace directory
   * and prevents path traversal attacks (e.g. '../', symlinks).
   */
  static async assertPathInsideCompany(companyId: string, targetPath: string): Promise<string> {
    const companyRoot = path.resolve(await this.getCompanyRoot(companyId));
    const resolvedTarget = path.resolve(targetPath);

    const rootNorm = process.platform === 'win32' ? companyRoot.toLowerCase() : companyRoot;
    const targetNorm = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;

    if (!targetNorm.startsWith(rootNorm + path.sep) && targetNorm !== rootNorm) {
      throw new Error(`PATH_TRAVERSAL_VIOLATION: Attempted access outside authorized company workspace for '${companyId}'.`);
    }

    return resolvedTarget;
  }

  /**
   * Resolves a deterministic partitioned file path for an original document
   * using a two-level hex prefix from its SHA-256 hash.
   * e.g. documents/originals/ab/cd/{docId}.enc
   */
  static async resolvePartitionedOriginalPath(
    companyId: string,
    documentId: string,
    fileHash?: string,
    _originalFileName?: string
  ): Promise<string> {
    const originalsRoot = await this.getOriginalsPath(companyId);
    const cleanId = path.basename(documentId || 'doc').replace(/[^a-zA-Z0-9_-]/g, '');

    if (fileHash) {
      if (!/^[a-fA-F0-9]{4,}$/.test(fileHash)) {
        throw new Error('PATH_TRAVERSAL_VIOLATION: Invalid file hash format for partitioned storage');
      }
      const p1 = fileHash.slice(0, 2).toLowerCase();
      const p2 = fileHash.slice(2, 4).toLowerCase();
      const prefixDir = path.join(originalsRoot, p1, p2);
      await this.ensureDirFast(prefixDir);
      const target = path.join(prefixDir, `${cleanId}.enc`);
      return this.assertPathInsideCompany(companyId, target);
    }

    const target = path.join(originalsRoot, `${cleanId}.enc`);
    return this.assertPathInsideCompany(companyId, target);
  }

  /**
   * Resolves a quarantine path for suspicious or unverified uploads.
   */
  static async resolveQuarantinePath(companyId: string, documentId: string): Promise<string> {
    const quarantineRoot = await this.getQuarantinePath(companyId);
    const cleanId = path.basename(documentId).replace(/[^a-zA-Z0-9_-]/g, '');
    const target = path.join(quarantineRoot, `${cleanId}.quarantine.enc`);
    return this.assertPathInsideCompany(companyId, target);
  }

  static async resolveDocumentPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const docsPath = await this.getDocumentsPath(companyId);
    const target = path.join(docsPath, safeFilename);
    return this.assertPathInsideCompany(companyId, target);
  }

  static async resolveBackupPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const backupsPath = await this.getBackupsPath(companyId);
    const target = path.join(backupsPath, safeFilename);
    return this.assertPathInsideCompany(companyId, target);
  }

  static async resolveExportPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const exportsPath = await this.getExportsPath(companyId);
    const target = path.join(exportsPath, safeFilename);
    return this.assertPathInsideCompany(companyId, target);
  }

  /**
   * Encrypts and writes a document buffer or stream into partitioned, independently encrypted storage.
   */
  static async writeEncryptedDocument(
    companyId: string,
    originalFilename: string,
    buffer: Buffer,
    options?: {
      documentId?: string;
      contentType?: string;
      quarantine?: boolean;
      customMetadata?: Record<string, any>;
    }
  ): Promise<{
    id: string;
    filePath: string;
    fileHash: string;
    plainSizeBytes: number;
    cipherSizeBytes: number;
    safeFilename: string;
    storageTier: StorageTier;
  }> {
    const id = options?.documentId || crypto.randomUUID();
    const cleanOriginalName = path.basename(originalFilename || 'document.bin');
    const contentType = options?.contentType || 'application/octet-stream';
    const isQuarantine = Boolean(options?.quarantine);
    const storageTier: StorageTier = isQuarantine ? 'quarantine' : 'originals';

    // 1. Encrypt payload with AES-256-GCM and bind AAD
    const encryptedResult = DocumentEncryptionService.encryptBuffer(
      companyId,
      id,
      buffer,
      {
        originalFileName: cleanOriginalName,
        contentType,
        customMetadata: options?.customMetadata,
      }
    );

    // 2. Resolve partitioned path based on file hash
    let finalPath: string;
    if (isQuarantine) {
      finalPath = await this.resolveQuarantinePath(companyId, id);
    } else {
      finalPath = await this.resolvePartitionedOriginalPath(companyId, id, encryptedResult.fileHash);
    }

    await this.assertPathInsideCompany(companyId, finalPath);

    // 3. Atomic write via temp file
    const tempDir = await this.getTempPath(companyId);
    const tempPath = path.join(tempDir, `${id}.upload.tmp.${crypto.randomUUID().slice(0, 8)}`);

    await fs.writeFile(tempPath, encryptedResult.encryptedBuffer);
    await fs.rename(tempPath, finalPath);

    return {
      id,
      filePath: finalPath,
      fileHash: encryptedResult.fileHash,
      plainSizeBytes: encryptedResult.plainSizeBytes,
      cipherSizeBytes: encryptedResult.cipherSizeBytes,
      safeFilename: `${id}.enc`,
      storageTier,
    };
  }

  /**
   * Encrypts a pre-streamed temporary file on disk directly into partitioned encrypted storage.
   * Useful for large file streaming uploads without loading into memory.
   */
  static async finalizeStreamedUpload(
    companyId: string,
    documentId: string,
    tempUploadedFilePath: string,
    originalFilename: string,
    options?: {
      contentType?: string;
      quarantine?: boolean;
      customMetadata?: Record<string, any>;
    }
  ): Promise<{
    id: string;
    filePath: string;
    fileHash: string;
    plainSizeBytes: number;
    cipherSizeBytes: number;
    storageTier: StorageTier;
  }> {
    const cleanOriginalName = path.basename(originalFilename || 'document.bin');
    const contentType = options?.contentType || 'application/octet-stream';
    const isQuarantine = Boolean(options?.quarantine);
    const storageTier: StorageTier = isQuarantine ? 'quarantine' : 'originals';

    // 1. Calculate plain hash first via stream pass
    const hash = crypto.createHash('sha256');
    const sizeStream = fsSync.createReadStream(tempUploadedFilePath);
    await new Promise<void>((resolve, reject) => {
      sizeStream.on('data', (d: Buffer | string) => hash.update(typeof d === 'string' ? Buffer.from(d) : d));
      sizeStream.on('end', () => resolve());
      sizeStream.on('error', reject);
    });
    const fileHash = hash.digest('hex');

    // 2. Resolve destination path
    let destPath: string;
    if (isQuarantine) {
      destPath = await this.resolveQuarantinePath(companyId, documentId);
    } else {
      destPath = await this.resolvePartitionedOriginalPath(companyId, documentId, fileHash);
    }

    await this.assertPathInsideCompany(companyId, destPath);

    // 3. Encrypt file stream
    const encryptedResult = await DocumentEncryptionService.encryptFileStream(
      companyId,
      documentId,
      tempUploadedFilePath,
      destPath,
      {
        originalFileName: cleanOriginalName,
        contentType,
        customMetadata: options?.customMetadata,
      }
    );

    // 4. Remove plain temp upload file
    await fs.unlink(tempUploadedFilePath).catch(() => {});

    return {
      id: documentId,
      filePath: destPath,
      fileHash: encryptedResult.fileHash,
      plainSizeBytes: encryptedResult.plainSizeBytes,
      cipherSizeBytes: encryptedResult.cipherSizeBytes,
      storageTier,
    };
  }

  /**
   * Legacy writeDocument method for backward compatibility:
   * automatically encrypts with AES-256-GCM and stores in partitioned structure.
   */
  static async writeDocument(
    companyId: string,
    originalFilename: string,
    buffer: Buffer | string
  ): Promise<{ id: string; filePath: string; safeFilename: string; fileHash: string }> {
    const buf = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
    const res = await this.writeEncryptedDocument(companyId, originalFilename, buf);
    return {
      id: res.id,
      filePath: res.filePath,
      safeFilename: res.safeFilename,
      fileHash: res.fileHash,
    };
  }

  /**
   * Cleans up temporary or aborted upload files.
   */
  static async cleanupFailedUpload(filePath?: string): Promise<void> {
    if (!filePath) return;
    try {
      if (fsSync.existsSync(filePath)) {
        await fs.unlink(filePath);
      }
    } catch {}
  }

  static async cleanupTempFiles(companyId: string, maxAgeMs: number = 3600 * 1000): Promise<number> {
    const tempDir = await this.getTempPath(companyId);
    if (!fsSync.existsSync(tempDir)) return 0;
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    let cleaned = 0;
    const now = Date.now();
    for (const ent of entries) {
      if (ent.isFile()) {
        const full = path.join(tempDir, ent.name);
        try {
          const st = await fs.stat(full);
          if (now - st.mtimeMs > maxAgeMs) {
            await fs.unlink(full);
            cleaned++;
          }
        } catch {}
      }
    }
    return cleaned;
  }

  /**
   * Scans company document repository and reports storage diagnostics:
   * orphaned physical files, missing database files, and unencrypted legacy files.
   */
  static async auditDocumentRepository(
    companyId: string,
    registeredDbDocMap?: Map<string, { id: string; filePath: string; fileHash?: string | null }>
  ): Promise<{
    registeredInDb: number;
    totalPhysicalFiles: number;
    totalRegisteredFiles: number;
    validOnDisk: number;
    orphanedFiles: string[];
    missingFiles: string[];
    unencryptedLegacyFiles: string[];
    corruptFiles: string[];
  }> {
    let docMap = registeredDbDocMap;
    if (!docMap) {
      docMap = new Map();
      try {
        const companyDb = await CompanyManager.getCompanyDb(companyId);
        const rows = await companyDb.select({
          id: schema.documents.id,
          filePath: schema.documents.filePath,
          fileHash: schema.documents.fileHash
        }).from(schema.documents).where(eq(schema.documents.companyId, companyId));
        for (const r of rows) {
          docMap.set(r.id, r);
        }
      } catch (dbErr: any) {
        console.warn('[StorageService] Error loading document rows for audit:', dbErr.message);
      }
    }

    const docsRoot = await this.getDocumentsPath(companyId);
    const physicalFiles: string[] = [];

    // Recursive traversal of docsRoot
    async function scanDir(dir: string) {
      if (!fsSync.existsSync(dir)) return;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== 'temp') {
            await scanDir(full);
          }
        } else if (ent.isFile()) {
          physicalFiles.push(path.resolve(full));
        }
      }
    }

    await scanDir(docsRoot);

    const physicalFilesSet = new Set(physicalFiles);
    const registeredPathsSet = new Set<string>();
    const entries = Array.from(docMap.entries());
    for (const [, doc] of entries) {
      registeredPathsSet.add(path.resolve(doc.filePath));
    }

    const orphanedFiles = physicalFiles.filter((p) => !registeredPathsSet.has(p));
    const missingFiles: string[] = [];
    const unencryptedLegacyFiles: string[] = [];
    const corruptFiles: string[] = [];

    const toVerify: Array<[string, { id: string; filePath: string; fileHash?: string | null }, string]> = [];
    for (const [docId, doc] of entries) {
      const resolved = path.resolve(doc.filePath);
      if (!physicalFilesSet.has(resolved) && !fsSync.existsSync(resolved)) {
        missingFiles.push(docId);
      } else {
        toVerify.push([docId, doc, resolved]);
      }
    }

    const BATCH_SIZE = 128;
    for (let i = 0; i < toVerify.length; i += BATCH_SIZE) {
      const batch = toVerify.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ([docId, doc, resolved]) => {
          const check = await DocumentEncryptionService.verifyDocumentIntegrity(
            companyId,
            docId,
            resolved,
            doc.fileHash || undefined
          );
          if (!check.valid) {
            if (check.error === 'UNENCRYPTED_LEGACY_CONTAINER') {
              unencryptedLegacyFiles.push(docId);
            } else if (check.error === 'FILE_NOT_FOUND_ON_DISK') {
              missingFiles.push(docId);
            } else {
              corruptFiles.push(docId);
            }
          }
        })
      );
    }

    const validOnDisk = docMap.size - missingFiles.length - unencryptedLegacyFiles.length - corruptFiles.length;

    return {
      registeredInDb: docMap.size,
      totalPhysicalFiles: physicalFiles.length,
      totalRegisteredFiles: docMap.size,
      validOnDisk: Math.max(0, validOnDisk),
      orphanedFiles,
      missingFiles,
      unencryptedLegacyFiles,
      corruptFiles,
    };
  }
}
