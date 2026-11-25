import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { DatabaseEncryptionService, FALLBACK_DEV_MASTER_SECRET } from './databaseEncryptionService';

const streamPipeline = promisify(pipeline);

export const DOC_MAGIC = Buffer.from('LAISDOC1', 'ascii'); // 8 bytes magic identifier
export const CURRENT_DOC_ENCRYPTION_VERSION = 1;

export interface DocumentAadMetadata {
  companyId: string;
  documentId: string;
  encryptionVersion: number;
  fileHash: string;
  originalFileName: string;
  contentType?: string;
  encryptedAt?: string;
  customMetadata?: Record<string, any>;
}

export class DocumentEncryptionService {
  private static masterKeyCache = new Map<string, { key: Buffer; expiresAt: number }>();

  public static clearMasterKeyCache(companyId?: string): void {
    if (companyId) {
      this.masterKeyCache.delete(companyId);
    } else {
      this.masterKeyCache.clear();
    }
  }

  /**
   * Derives a dedicated 256-bit Document Master Key for the specified company
   * using HKDF-SHA256 from the company's authenticated Key Encryption Key (KEK).
   * Does NOT store raw keys beside files.
   */
  public static deriveCompanyDocumentMasterKey(companyId: string): Buffer {
    const now = Date.now();
    const cached = this.masterKeyCache.get(companyId);
    if (cached && cached.expiresAt > now) {
      return cached.key;
    }

    let companyKek: Buffer;
    try {
      const keyring = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(companyId);
      companyKek = keyring.kek;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `PRODUCTION_KEY_POLICY_VIOLATION: Document encryption master key derivation failed in production without an active keyring (${err?.message || 'keyring unavailable'}).`
        );
      }
      const envSecret = process.env.LEDGERAI_MASTER_KEY;
      if ((!envSecret || envSecret === FALLBACK_DEV_MASTER_SECRET) && String(companyId || '').toUpperCase().includes('PROD')) {
        throw new Error(
          'PRODUCTION_KEY_POLICY_VIOLATION: Deterministic fallback development secret cannot be used for production companies.'
        );
      }
      const masterSecret = envSecret || FALLBACK_DEV_MASTER_SECRET;
      companyKek = crypto.pbkdf2Sync(
        masterSecret,
        Buffer.from(`salt:${companyId}:dev-fallback`, 'utf8'),
        100000,
        32,
        'sha256'
      );
    }

    const salt = Buffer.from('ledgerai-ph:document-encryption:salt:v1', 'utf8');
    const info = Buffer.from(`ledgerai-ph:document-master-key:${companyId}:v${CURRENT_DOC_ENCRYPTION_VERSION}`, 'utf8');

    const derived = Buffer.from(crypto.hkdfSync('sha256', companyKek, salt, info, 32));
    this.masterKeyCache.set(companyId, { key: derived, expiresAt: now + 10000 });
    return derived;
  }

  /**
   * Derives a document-unique 256-bit Data Encryption Key (DEK)
   * bound cryptographically to the document ID.
   */
  public static derivePerDocumentKey(companyDocMasterKey: Buffer, documentId: string): Buffer {
    const docSalt = crypto.createHash('sha256').update(`doc-salt:${documentId}`).digest();
    const docInfo = Buffer.from(`ledgerai-ph:document-dek:${documentId}`, 'utf8');
    return Buffer.from(crypto.hkdfSync('sha256', companyDocMasterKey, docSalt, docInfo, 32));
  }

  /**
   * Formats canonical AAD buffer from metadata to prevent field reordering ambiguities.
   */
  public static formatAadBuffer(metadata: DocumentAadMetadata): Buffer {
    const canonical = {
      companyId: metadata.companyId,
      contentType: metadata.contentType || 'application/octet-stream',
      documentId: metadata.documentId,
      encryptionVersion: metadata.encryptionVersion || CURRENT_DOC_ENCRYPTION_VERSION,
      fileHash: metadata.fileHash,
      originalFileName: metadata.originalFileName,
    };
    return Buffer.from(JSON.stringify(canonical), 'utf8');
  }

  /**
   * Checks whether a file has the LAISDOC1 magic header.
   */
  public static async isEncryptedContainer(filePathOrBuffer: string | Buffer): Promise<boolean> {
    if (Buffer.isBuffer(filePathOrBuffer)) {
      return filePathOrBuffer.length >= 8 && filePathOrBuffer.subarray(0, 8).equals(DOC_MAGIC);
    }
    try {
      const handle = await fs.open(filePathOrBuffer, 'r');
      try {
        const headerBuf = Buffer.alloc(8);
        const { bytesRead } = await handle.read(headerBuf, 0, 8, 0);
        if (bytesRead < 8) return false;
        return headerBuf.equals(DOC_MAGIC);
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * Checks whether a file is an unencrypted legacy file.
   */
  public static async isPlaintextLegacy(filePath: string): Promise<boolean> {
    try {
      const exists = await fs.stat(filePath);
      if (!exists.isFile()) return false;
      const isEnc = await this.isEncryptedContainer(filePath);
      return !isEnc;
    } catch {
      return false;
    }
  }

  /**
   * Encrypts a plain buffer into an authenticated LAISDOC1 container buffer.
   */
  public static encryptBuffer(
    companyId: string,
    documentId: string,
    plainBuffer: Buffer,
    metadata: Omit<DocumentAadMetadata, 'companyId' | 'documentId' | 'encryptionVersion' | 'fileHash'>
  ): { encryptedBuffer: Buffer; fileHash: string; plainSizeBytes: number; cipherSizeBytes: number } {
    const fileHash = crypto.createHash('sha256').update(plainBuffer).digest('hex');
    const fullMeta: DocumentAadMetadata = {
      ...metadata,
      companyId,
      documentId,
      encryptionVersion: CURRENT_DOC_ENCRYPTION_VERSION,
      fileHash,
      encryptedAt: new Date().toISOString(),
    };

    const aadBuffer = this.formatAadBuffer(fullMeta);
    const companyMasterKey = this.deriveCompanyDocumentMasterKey(companyId);
    const docDek = this.derivePerDocumentKey(companyMasterKey, documentId);

    const iv = crypto.randomBytes(12); // 96-bit unique nonce
    const cipher = crypto.createCipheriv('aes-256-gcm', docDek, iv);
    cipher.setAAD(aadBuffer);

    const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const tag = cipher.getAuthTag(); // 128-bit authentication tag

    // Header layout:
    // [0..7]: DOC_MAGIC (8 bytes)
    // [8..9]: Version (uint16 BE, 2 bytes)
    // [10..21]: IV (12 bytes)
    // [22..37]: Tag (16 bytes)
    // [38..39]: AadLength (uint16 BE, 2 bytes)
    // [40..40+aadLength]: AAD JSON bytes
    // [rest]: Ciphertext
    const versionBuf = Buffer.alloc(2);
    versionBuf.writeUInt16BE(CURRENT_DOC_ENCRYPTION_VERSION, 0);

    const aadLenBuf = Buffer.alloc(2);
    aadLenBuf.writeUInt16BE(aadBuffer.length, 0);

    const containerHeader = Buffer.concat([DOC_MAGIC, versionBuf, iv, tag, aadLenBuf, aadBuffer]);
    const encryptedBuffer = Buffer.concat([containerHeader, ciphertext]);

    return {
      encryptedBuffer,
      fileHash,
      plainSizeBytes: plainBuffer.length,
      cipherSizeBytes: encryptedBuffer.length,
    };
  }

  /**
   * Decrypts an authenticated LAISDOC1 container buffer, verifying AAD and GCM auth tag.
   */
  public static decryptBuffer(
    companyId: string,
    documentId: string,
    encryptedBuffer: Buffer
  ): { plainBuffer: Buffer; metadata: DocumentAadMetadata } {
    if (encryptedBuffer.length < 40) {
      throw new Error('INVALID_DOCUMENT_CONTAINER: Document container is too small to contain valid header.');
    }

    const magic = encryptedBuffer.subarray(0, 8);
    if (!magic.equals(DOC_MAGIC)) {
      throw new Error('UNENCRYPTED_OR_CORRUPT_DOCUMENT: Document does not contain valid LAISDOC1 encryption magic header.');
    }

    const version = encryptedBuffer.readUInt16BE(8);
    if (version !== CURRENT_DOC_ENCRYPTION_VERSION) {
      throw new Error(`UNSUPPORTED_ENCRYPTION_VERSION: Version ${version} is not supported (expected ${CURRENT_DOC_ENCRYPTION_VERSION}).`);
    }

    const iv = encryptedBuffer.subarray(10, 22);
    const tag = encryptedBuffer.subarray(22, 38);
    const aadLength = encryptedBuffer.readUInt16BE(38);

    if (encryptedBuffer.length < 40 + aadLength) {
      throw new Error('CORRUPT_DOCUMENT_CONTAINER: AAD block exceeds buffer length.');
    }

    const aadBuffer = encryptedBuffer.subarray(40, 40 + aadLength);
    const ciphertext = encryptedBuffer.subarray(40 + aadLength);

    let parsedMeta: DocumentAadMetadata;
    try {
      parsedMeta = JSON.parse(aadBuffer.toString('utf8'));
    } catch {
      throw new Error('CORRUPT_DOCUMENT_CONTAINER: AAD metadata is not valid JSON.');
    }

    // AAD Cross-Tenant & Document Identity Binding Validation
    if (parsedMeta.companyId !== companyId) {
      throw new Error(
        `CROSS_COMPANY_ACCESS_DENIED: Document AAD company binding mismatch (container is bound to company '${parsedMeta.companyId}', caller is '${companyId}').`
      );
    }

    if (parsedMeta.documentId !== documentId) {
      throw new Error(
        `DOCUMENT_ID_TAMPER_DETECTED: Document AAD ID mismatch (container is bound to doc '${parsedMeta.documentId}', requested '${documentId}').`
      );
    }

    const companyMasterKey = this.deriveCompanyDocumentMasterKey(companyId);
    const docDek = this.derivePerDocumentKey(companyMasterKey, documentId);

    const decipher = crypto.createDecipheriv('aes-256-gcm', docDek, iv);
    decipher.setAAD(aadBuffer);
    decipher.setAuthTag(tag);

    try {
      const plainBuffer = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      // Verify decrypted file payload hash
      const verifiedHash = crypto.createHash('sha256').update(plainBuffer).digest('hex');
      if (parsedMeta.fileHash && verifiedHash !== parsedMeta.fileHash) {
        throw new Error('FILE_HASH_MISMATCH: Decrypted document payload does not match authenticated SHA-256 hash.');
      }

      return { plainBuffer, metadata: parsedMeta };
    } catch (err: any) {
      if (err.message?.includes('HASH_MISMATCH') || err.message?.includes('CROSS_COMPANY')) {
        throw err;
      }
      throw new Error('AUTH_TAG_VERIFICATION_FAILED: Document ciphertext has been tampered with or incorrect key used.');
    }
  }

  /**
   * Encrypts a source file on disk directly to an encrypted destination file using streaming.
   * Calculates SHA-256 hash on-the-fly and never buffers the entire plain file in memory.
   */
  public static async encryptFileStream(
    companyId: string,
    documentId: string,
    sourcePlainFilePath: string,
    destEncryptedFilePath: string,
    metadata: Omit<DocumentAadMetadata, 'companyId' | 'documentId' | 'encryptionVersion' | 'fileHash'>
  ): Promise<{ fileHash: string; plainSizeBytes: number; cipherSizeBytes: number }> {
    // 1. First pass: compute exact SHA-256 and size via stream
    const hash = crypto.createHash('sha256');
    let plainSizeBytes = 0;

    const sizeStream = fsSync.createReadStream(sourcePlainFilePath);
    await new Promise<void>((resolve, reject) => {
      sizeStream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        plainSizeBytes += buf.length;
        hash.update(buf);
      });
      sizeStream.on('end', () => resolve());
      sizeStream.on('error', reject);
    });

    const fileHash = hash.digest('hex');

    const fullMeta: DocumentAadMetadata = {
      ...metadata,
      companyId,
      documentId,
      encryptionVersion: CURRENT_DOC_ENCRYPTION_VERSION,
      fileHash,
      encryptedAt: new Date().toISOString(),
    };

    const aadBuffer = this.formatAadBuffer(fullMeta);
    const companyMasterKey = this.deriveCompanyDocumentMasterKey(companyId);
    const docDek = this.derivePerDocumentKey(companyMasterKey, documentId);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', docDek, iv);
    cipher.setAAD(aadBuffer);

    // Ensure destination directory exists
    await fs.mkdir(path.dirname(destEncryptedFilePath), { recursive: true });

    // Stream encryption pass to temporary output file
    const tempEncPath = `${destEncryptedFilePath}.tmp.${crypto.randomUUID().slice(0, 8)}`;
    const outWriteStream = fsSync.createWriteStream(tempEncPath);

    // Write header placeholder (40 + aadLength bytes)
    const versionBuf = Buffer.alloc(2);
    versionBuf.writeUInt16BE(CURRENT_DOC_ENCRYPTION_VERSION, 0);

    const dummyTag = Buffer.alloc(16); // Will be rewritten after stream completes
    const aadLenBuf = Buffer.alloc(2);
    aadLenBuf.writeUInt16BE(aadBuffer.length, 0);

    const initialHeader = Buffer.concat([DOC_MAGIC, versionBuf, iv, dummyTag, aadLenBuf, aadBuffer]);
    outWriteStream.write(initialHeader);

    const readPlainStream = fsSync.createReadStream(sourcePlainFilePath);

    await streamPipeline(readPlainStream, cipher, outWriteStream);

    const authTag = cipher.getAuthTag();

    // Overwrite the placeholder auth tag in the header (offset 22..37)
    const fileHandle = await fs.open(tempEncPath, 'r+');
    try {
      await fileHandle.write(authTag, 0, 16, 22);
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    // Atomic finalize
    await fs.rename(tempEncPath, destEncryptedFilePath);

    const stat = await fs.stat(destEncryptedFilePath);
    return {
      fileHash,
      plainSizeBytes,
      cipherSizeBytes: stat.size,
    };
  }

  /**
   * Decrypts an encrypted document on disk and returns its plain Buffer.
   */
  public static async decryptFile(
    companyId: string,
    documentId: string,
    encryptedFilePath: string
  ): Promise<{ buffer: Buffer; metadata: DocumentAadMetadata }> {
    const encBuffer = await fs.readFile(encryptedFilePath);
    const { plainBuffer, metadata } = this.decryptBuffer(companyId, documentId, encBuffer);
    return { buffer: plainBuffer, metadata };
  }

  /**
   * Verifies the cryptographic integrity of an encrypted document file on disk
   * without returning the full plaintext payload.
   */
  public static async verifyDocumentIntegrity(
    companyId: string,
    documentId: string,
    encryptedFilePath: string,
    expectedHash?: string
  ): Promise<{ valid: boolean; metadata?: DocumentAadMetadata; error?: string }> {
    try {
      let encBuffer: Buffer;
      try {
        encBuffer = await fs.readFile(encryptedFilePath);
      } catch {
        return { valid: false, error: 'FILE_NOT_FOUND_ON_DISK' };
      }

      if (encBuffer.length < 8 || !encBuffer.subarray(0, 8).equals(DOC_MAGIC)) {
        return { valid: false, error: 'UNENCRYPTED_LEGACY_CONTAINER' };
      }

      const { metadata } = this.decryptBuffer(companyId, documentId, encBuffer);
      if (expectedHash && metadata.fileHash !== expectedHash) {
        return { valid: false, metadata, error: `HASH_MISMATCH: expected ${expectedHash}, got ${metadata.fileHash}` };
      }

      return { valid: true, metadata };
    } catch (err: any) {
      return { valid: false, error: err.message || 'INTEGRITY_CHECK_FAILED' };
    }
  }

  /**
   * Migrates an existing legacy plaintext document file to an independently encrypted LAISDOC1 container.
   */
  public static async migratePlaintextFile(
    companyId: string,
    documentId: string,
    legacyFilePath: string,
    destEncryptedFilePath?: string,
    metadata?: Omit<DocumentAadMetadata, 'companyId' | 'documentId' | 'encryptionVersion' | 'fileHash'> | string
  ): Promise<{ newEncryptedPath: string; fileHash: string; plainSizeBytes: number; cipherSizeBytes: number }> {
    const isEnc = await this.isEncryptedContainer(legacyFilePath);
    if (isEnc) {
      throw new Error('ALREADY_ENCRYPTED: Specified file is already an encrypted LAISDOC1 container.');
    }

    const resolvedDest = destEncryptedFilePath || `${legacyFilePath}.enc`;
    let meta: Omit<DocumentAadMetadata, 'companyId' | 'documentId' | 'encryptionVersion' | 'fileHash'>;
    if (typeof metadata === 'string') {
      meta = { originalFileName: metadata };
    } else if (metadata) {
      meta = metadata;
    } else {
      meta = { originalFileName: path.basename(legacyFilePath) };
    }

    const result = await this.encryptFileStream(
      companyId,
      documentId,
      legacyFilePath,
      resolvedDest,
      meta
    );

    // Verify written container immediately
    const check = await this.verifyDocumentIntegrity(companyId, documentId, resolvedDest, result.fileHash);
    if (!check.valid) {
      await fs.unlink(resolvedDest).catch(() => {});
      throw new Error(`MIGRATION_VERIFICATION_FAILED: ${check.error}`);
    }

    // Safely delete legacy unencrypted file
    await fs.unlink(legacyFilePath).catch(() => {});

    return {
      newEncryptedPath: resolvedDest,
      fileHash: result.fileHash,
      plainSizeBytes: result.plainSizeBytes,
      cipherSizeBytes: result.cipherSizeBytes,
    };
  }
}
