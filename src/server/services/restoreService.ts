import { db } from '../db';
import * as schema from '../db/schema';
import crypto from 'crypto';
import { inArray, eq, sql } from 'drizzle-orm';
import { CompanyManager } from './companyManager';
import Database from 'better-sqlite3';
import path from 'path';
import zlib from 'zlib';
import fs from 'fs/promises';
import fsSync from 'fs';
import { CompanyStorageService } from './storageService';

const BACKUP_SECRET = 'ledgerai-ph-proprietary-backup-signing-key-2026';

export interface BackupPayload {
  metadata: {
    version: string;
    schemaVersion?: string;
    timestamp: string;
    checksum: string;
    signature: string;
    format: string;
    companyId: string;
    companyName?: string;
  };
  data: Record<string, any[]>;
}

export function deterministicStringify(obj: any): string {
  if (obj === undefined) return '';
  if (obj === null) return 'null';
  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(v => v === undefined ? 'null' : deterministicStringify(v)).join(',') + ']';
  } else if (typeof obj === 'object') {
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + deterministicStringify(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

export class RestoreService {
  private static activeBackupLocks: Set<string> = new Set();

  static acquireBackupLock(companyId: string): boolean {
    if (this.activeBackupLocks.has(companyId)) {
      return false;
    }
    this.activeBackupLocks.add(companyId);
    return true;
  }

  static releaseBackupLock(companyId: string): void {
    this.activeBackupLocks.delete(companyId);
  }

  static async createAtomicBackup(
    companyId: string,
    userId: string,
    customBackupName?: string
  ): Promise<{
    id: string;
    filename: string;
    backupPath: string;
    checksum: string;
    sizeBytes: number;
    payload: BackupPayload;
  }> {
    if (!this.acquireBackupLock(companyId)) {
      throw new Error("CONCURRENCY_LOCK: A backup operation is already in progress for this company. Please wait until it completes.");
    }

    try {
      try {
        const companyDb = await CompanyManager.getCompanyDb(companyId);
        await companyDb.run(sql`PRAGMA wal_checkpoint(FULL);`);
        await companyDb.run(sql`PRAGMA integrity_check;`);
      } catch (pragmaErr: any) {
        console.warn("[Backup Safety] SQLite PRAGMA check warning:", pragmaErr.message);
      }

      const payload = await this.exportBackup(companyId);
      const buffer = this.serializeLai(payload);

      const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
      const legalName = company?.legalName || "Company";
      const sanitizedLegalName = legalName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}-${hours}${minutes}`;
      const filename = customBackupName ? `${customBackupName}.lai` : `${sanitizedLegalName}-${formattedDate}.lai`;

      const backupDir = await CompanyStorageService.getBackupsPath(companyId);
      await fs.mkdir(backupDir, { recursive: true });
      const finalBackupPath = path.join(backupDir, filename);

      const tempFilename = `${filename}.tmp.${crypto.randomUUID().slice(0, 8)}`;
      const tempBackupPath = path.join(backupDir, tempFilename);

      const fileHandle = await fs.open(tempBackupPath, 'w');
      try {
        await fileHandle.write(buffer, 0, buffer.length, 0);
        await fileHandle.sync();
      } finally {
        await fileHandle.close();
      }

      const writtenBuffer = await fs.readFile(tempBackupPath);
      const verifiedPayload = this.deserializeLai(writtenBuffer);
      if (verifiedPayload.metadata.checksum !== payload.metadata.checksum) {
        await fs.unlink(tempBackupPath).catch(() => {});
        throw new Error("ATOMIC_WRITE_VERIFICATION_FAILED: Written temporary backup checksum mismatch.");
      }

      await fs.rename(tempBackupPath, finalBackupPath);

      const backupId = crypto.randomUUID();
      await db.insert(schema.systemBackups).values({
        id: backupId,
        companyId,
        backupName: filename,
        checksum: payload.metadata.checksum,
        sizeBytes: buffer.length,
        passwordProtected: true,
        payloadJson: JSON.stringify(payload),
        createdBy: userId
      });

      return {
        id: backupId,
        filename,
        backupPath: finalBackupPath,
        checksum: payload.metadata.checksum,
        sizeBytes: buffer.length,
        payload
      };
    } finally {
      this.releaseBackupLock(companyId);
    }
  }

  static serializeLai(payload: BackupPayload): Buffer {
    // 1. Prepare metadata payload without the heavy 'data' field
    const metadata = { ...payload.metadata, format: 'LAI_DATABASE_V1' };
    const metaJsonStr = JSON.stringify(metadata);
    const metaBuffer = Buffer.from(metaJsonStr, 'utf8');

    // 2. Prepare compressed data payload
    const dataJsonStr = JSON.stringify(payload.data);
    const compressedData = zlib.gzipSync(dataJsonStr);

    // 3. Assemble binary container with LAIPH1 magic header
    const magic = Buffer.from('LAIPH1', 'ascii'); // 6 bytes
    
    const metaLenBuf = Buffer.alloc(4);
    metaLenBuf.writeUInt32BE(metaBuffer.length, 0); // 4 bytes

    const dataLenBuf = Buffer.alloc(4);
    dataLenBuf.writeUInt32BE(compressedData.length, 0); // 4 bytes

    // Total Buffer
    return Buffer.concat([magic, metaLenBuf, metaBuffer, dataLenBuf, compressedData]);
  }

  // Legacy alias for backward compatibility
  static serializeLgb(payload: BackupPayload): Buffer {
    return this.serializeLai(payload);
  }

  static deserializeLai(buffer: Buffer | string): BackupPayload {
    let buf: Buffer;
    if (typeof buffer === 'string') {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:') && trimmed.includes('base64,')) {
        const base64Data = trimmed.split('base64,')[1];
        buf = Buffer.from(base64Data, 'base64');
      } else {
        // Try decoding as base64 first
        buf = Buffer.from(trimmed, 'base64');
        const header6 = buf.length >= 6 ? buf.toString('ascii', 0, 6) : '';
        if (buf.length < 14 || (header6 !== 'LAIPH1' && header6 !== 'LGBPH1')) {
          // If not a valid base64 representation of LAIPH1 or LGBPH1, fall back to binary
          buf = Buffer.from(trimmed, 'binary');
        }
      }
    } else {
      buf = buffer;
    }

    // Now validate the magic bytes (LAIPH1 or legacy LGBPH1)
    const headerMagic = buf.length >= 6 ? buf.toString('ascii', 0, 6) : '';
    if (buf.length < 14 || (headerMagic !== 'LAIPH1' && headerMagic !== 'LGBPH1')) {
      const textSample = buf.toString('utf8', 0, 100).trim();
      if (textSample.startsWith('{') || textSample.includes('"metadata"')) {
        throw new Error("INVALID_BACKUP_FORMAT: Standard JSON files cannot be used as official company database backups. You cannot simply rename a .json file to .lai; it must be a real LedgerAI PH binary database package (.lai).");
      }
      throw new Error("INVALID_BACKUP_FORMAT: Not a valid LedgerAI PH proprietary database backup package (.lai). File header is missing magic identifier.");
    }

    try {
      // Read Metadata length
      const metaLen = buf.readUInt32BE(6);
      if (buf.length < 14 + metaLen) {
        throw new Error("CORRUPTED_PACKAGE: Metadata block length mismatch.");
      }

      // Read Metadata string
      const metaStr = buf.toString('utf8', 10, 10 + metaLen);
      const metadata = JSON.parse(metaStr);

      // Read Data length
      const dataLen = buf.readUInt32BE(10 + metaLen);
      if (buf.length < 14 + metaLen + dataLen) {
        throw new Error("CORRUPTED_PACKAGE: Compressed data block length mismatch.");
      }

      // Read Data block
      const compressedData = buf.subarray(14 + metaLen, 14 + metaLen + dataLen);
      const decompressedDataStr = zlib.gunzipSync(compressedData).toString('utf8');
      const data = JSON.parse(decompressedDataStr);

      const payload: BackupPayload = {
        metadata,
        data
      };

      // Now run our validation
      return this.validateBackupFile(payload);
    } catch (e: any) {
      if (e.message.startsWith("INVALID_BACKUP_FORMAT") || e.message.startsWith("TAMPER_DETECTED") || e.message.startsWith("CHECKSUM_MISMATCH") || e.message.includes("Standard JSON")) {
        throw e;
      }
      throw new Error(`INVALID_BACKUP_STRUCTURE: Failed to unpack the proprietary .lai database package structure: ${e.message}`);
    }
  }

  // Legacy alias for backward compatibility
  static deserializeLgb(buffer: Buffer | string): BackupPayload {
    return this.deserializeLai(buffer);
  }

  static generateSignature(data: any): string {
    const dataString = deterministicStringify(data);
    return crypto.createHmac('sha256', BACKUP_SECRET).update(dataString).digest('hex');
  }

  static verifySignature(payload: BackupPayload): boolean {
    if (!payload.metadata?.signature) return false;
    const expectedSig = this.generateSignature(payload.data);
    return crypto.timingSafeEqual(Buffer.from(payload.metadata.signature, 'hex'), Buffer.from(expectedSig, 'hex'));
  }

  static validateBackupFile(payload: BackupPayload): BackupPayload {
    if (!payload.metadata || !payload.metadata.checksum || !payload.metadata.companyId || !payload.data) {
      throw new Error("INVALID_BACKUP_STRUCTURE: Missing required backup metadata or database records.");
    }

    const versionMatch = payload.metadata.version === '1.0' || payload.metadata.version === '1.1';
    if (!versionMatch) {
      throw new Error("BACKUP_VERSION_INCOMPATIBLE: Unsupported backup version.");
    }

    // Verify Checksum
    const dataString = deterministicStringify(payload.data);
    const calculatedChecksum = crypto.createHash('sha256').update(dataString).digest('hex');
    if (calculatedChecksum !== payload.metadata.checksum) {
      throw new Error("CHECKSUM_MISMATCH: Backup file integrity check failed (checksum mismatch or corrupted backup).");
    }

    // Verify Proprietary Signature if present (or require for .lgb)
    if (payload.metadata.signature) {
      if (!RestoreService.verifySignature(payload)) {
        throw new Error("TAMPER_DETECTED: Cryptographic signature verification failed. The backup package has been tampered with or is invalid.");
      }
    }

    return payload as BackupPayload;
  }

  static verifyChecksum(payload: BackupPayload): boolean {
    const dataString = deterministicStringify(payload.data);
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');
    return hash === payload.metadata.checksum;
  }

  static generateChecksum(data: any): string {
    const dataString = deterministicStringify(data);
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  static remapUuids(payload: BackupPayload, targetCompanyId?: string): { payload: BackupPayload, oldCompanyId: string, newCompanyId: string } {
    const idMap = new Map<string, string>();
    const oldCompanyId = payload.metadata.companyId;
    const newCompanyId = targetCompanyId || oldCompanyId;
    
    idMap.set(oldCompanyId, newCompanyId);
    
    const companyScopedTables = [
      'companies', 'companyUsers', 'companyTaxProfiles', 'accounts',
      'accountingPeriods', 'journalEntries', 'journalLines',
      'auditLogs', 'documents', 'vendors', 'customers', 'taxCodes',
      'taxCalculations', 'salesInvoices', 'salesInvoiceLines',
      'purchaseBills', 'purchaseBillLines', 'supplierPayments',
      'supplierPaymentApplications', 'cashTransactions',
      'cashTransactionLines', 'cashAdvances'
    ];

    for (const table of companyScopedTables) {
      if (payload.data[table]) {
        for (const row of payload.data[table]) {
          if (row.id) {
            if (!idMap.has(row.id)) {
               idMap.set(row.id, crypto.randomUUID());
            }
          }
        }
      }
    }

    function replaceUuids(obj: any): any {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) return obj.map(replaceUuids);
      if (typeof obj === 'object') {
        const newObj: any = {};
        for (const [k, v] of Object.entries(obj)) {
          if ((k === 'userId' || k === 'user_id' || k === 'roleId' || k === 'role_id') && typeof v === 'string') {
            newObj[k] = v;
          } else if (typeof v === 'string' && idMap.has(v)) {
            newObj[k] = idMap.get(v);
          } else if (typeof v === 'object') {
            newObj[k] = replaceUuids(v);
          } else {
            newObj[k] = v;
          }
        }
        return newObj;
      }
      return obj;
    }

    const newData = replaceUuids(payload.data);

    if (payload.data.documentFiles) {
      const newDocumentFiles: Record<string, string> = {};
      for (const [oldBasename, content] of Object.entries(payload.data.documentFiles)) {
        const ext = path.extname(oldBasename);
        const oldId = path.basename(oldBasename, ext);
        const newId = idMap.get(oldId) || oldId;
        newDocumentFiles[`${newId}${ext}`] = content as string;
      }
      newData.documentFiles = newDocumentFiles;
    }

    const newPayload = {
      ...payload,
      metadata: {
        ...payload.metadata,
        companyId: newCompanyId,
      },
      data: newData
    };

    return { payload: newPayload, oldCompanyId, newCompanyId };
  }

  static async restoreDatabase(payload: BackupPayload, targetCompanyId: string, mode: 'NEW' | 'REPLACE', userId: string | null = null, destinationPath?: string): Promise<string> {
    
    let finalPayload = payload;
    let finalCompanyId = targetCompanyId || payload.metadata.companyId;

    const existingCompanies = await CompanyManager.listCompanies();
    const existsLocally = existingCompanies.some(c => c.id === payload.metadata.companyId);

    if (mode === 'NEW') {
      const remapped = this.remapUuids(payload, targetCompanyId);
      finalPayload = remapped.payload;
      finalCompanyId = remapped.newCompanyId;
    } else {
      if (payload.metadata.companyId !== targetCompanyId) {
        throw new Error("Backup file company ID does not match target company");
      }
      if (payload.data?.companies?.[0]?.id && payload.data.companies[0].id !== targetCompanyId) {
        throw new Error("Company ID in database payload does not match target company ID");
      }
    }

    // If a custom destination path is provided, create the company profile profile there
    let companyName = payload.metadata.companyName;
    if (finalPayload.data.companies && finalPayload.data.companies.length > 0) {
      companyName = finalPayload.data.companies[0].legalName || companyName || "Restored Company";
    }

    let manifest: any;
    const existing = existingCompanies.find(c => c.id === finalCompanyId);

    if (destinationPath) {
      manifest = await CompanyManager.createCompanyProfile(finalCompanyId, companyName || "Restored Company", destinationPath, undefined, true);
    } else {
      if (!existing) {
        manifest = await CompanyManager.createCompanyProfile(finalCompanyId, companyName || "Restored Company", undefined, undefined, true);
      } else {
        manifest = existing;
      }
    }

    // Reconstruct valid document file paths for target system
    if (finalPayload.data.documents) {
      const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
      for (const row of finalPayload.data.documents) {
        const ext = path.extname(row.fileName || '');
        const safeFilename = `${row.id}${ext}`;
        row.filePath = path.join(targetDocsDir, safeFilename);
      }
    }

    // Write physical documents to disk if present
    if (finalPayload.data.documentFiles) {
      const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
      await fs.mkdir(targetDocsDir, { recursive: true });
      for (const [filename, base64Content] of Object.entries(finalPayload.data.documentFiles)) {
        const destPath = path.join(targetDocsDir, filename);
        const buf = Buffer.from(base64Content as string, 'base64');
        await fs.writeFile(destPath, buf);

        const matchingDoc = finalPayload.data.documents?.find((d: any) => path.basename(d.filePath) === filename || d.fileName === filename);
        if (matchingDoc) {
          const ext = path.extname(filename);
          const uuidPath = path.join(targetDocsDir, `${matchingDoc.id}${ext}`);
          await fs.writeFile(uuidPath, buf);
        }
      }
    }

    const targetDb = await CompanyManager.getCompanyDb(finalCompanyId);

    const mapDates = (obj: any): any => {
      for (const k in obj) {
        if (typeof obj[k] === 'number' && (k.endsWith('At') || k === 'timestamp')) {
           obj[k] = new Date(obj[k]);
        } else if (typeof obj[k] === 'string' && (k.endsWith('At' ) || k === 'timestamp' || /^\+?\d+-\d{2}-\d{2}T/.test(obj[k]))) {
           obj[k] = new Date(obj[k]);
        }
      }
      return obj;
    };

    const explicitOrder = [
      'companies',
      'users',
      'roles',
      'companyLicenses',
      'companyUsers',
      'companyTaxProfiles',
      'accountingPeriods',
      'taxCodes',
      'accounts',
      'vendors',
      'customers',
      'salesInvoices',
      'salesInvoiceLines',
      'purchaseBills',
      'purchaseBillLines',
      'supplierPayments',
      'supplierPaymentApplications',
      'journalEntries',
      'journalLines',
      'cashAdvances',
      'cashTransactions',
      'cashTransactionLines',
      'taxCalculations',
      'documents',
      'auditLogs',
      'approvalWorkflowRequests',
      'auditEngagements',
      'auditWorkpapers',
      'auditFindings',
      'auditAdjustments'
    ];

    await targetDb.transaction(async (tx) => {
      
      if (mode === 'REPLACE' || mode === 'NEW') {
        const je = await tx.select({ id: schema.journalEntries.id }).from(schema.journalEntries);
        if (je.length > 0) {
          for (let i = 0; i < je.length; i += 1000) {
            const chunk = je.slice(i, i + 1000).map(x => x.id);
            await tx.delete(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, chunk));
          }
        }
        
        const inv = await tx.select({ id: schema.salesInvoices.id }).from(schema.salesInvoices);
        if (inv.length > 0) {
          for (let i = 0; i < inv.length; i += 1000) {
            const chunk = inv.slice(i, i + 1000).map(x => x.id);
            await tx.delete(schema.salesInvoiceLines).where(inArray(schema.salesInvoiceLines.invoiceId, chunk));
          }
        }

        const bills = await tx.select({ id: schema.purchaseBills.id }).from(schema.purchaseBills);
        if (bills.length > 0) {
          for (let i = 0; i < bills.length; i += 1000) {
            const chunk = bills.slice(i, i + 1000).map(x => x.id);
            await tx.delete(schema.purchaseBillLines).where(inArray(schema.purchaseBillLines.billId, chunk));
          }
        }

        const payments = await tx.select({ id: schema.supplierPayments.id }).from(schema.supplierPayments);
        if (payments.length > 0) {
          for (let i = 0; i < payments.length; i += 1000) {
            const chunk = payments.slice(i, i + 1000).map(x => x.id);
            await tx.delete(schema.supplierPaymentApplications).where(inArray(schema.supplierPaymentApplications.paymentId, chunk));
          }
        }

        const cashTxs = await tx.select({ id: schema.cashTransactions.id }).from(schema.cashTransactions);
        if (cashTxs.length > 0) {
          for (let i = 0; i < cashTxs.length; i += 1000) {
            const chunk = cashTxs.slice(i, i + 1000).map(x => x.id);
            await tx.delete(schema.cashTransactionLines).where(inArray(schema.cashTransactionLines.cashTransactionId, chunk));
          }
        }

        const reverseOrder = [...explicitOrder].reverse();
        for (const key of reverseOrder) {
          if (key !== 'companies' && key !== 'companyLicenses' && key !== 'companyUsers') {
            const table = (schema as any)[key];
            if (table) {
              try {
                await tx.delete(table);
              } catch {
                // Ignore table delete errors
              }
            }
          }
        }
      }

      for (const key of explicitOrder) {
        if (finalPayload.data[key] && finalPayload.data[key].length > 0) {
          const table = (schema as any)[key];
          const rows = finalPayload.data[key];
          
          if (key === 'companies' || key === 'companyLicenses') {
            for (const row of rows) {
              const item = { ...row };
              if ('company_id' in item) item.company_id = finalCompanyId;
              if ('companyId' in item) item.companyId = finalCompanyId;
              if (key === 'companies') {
                item.id = finalCompanyId;
                delete item.document_location_path;
                delete item.documentLocationPath;
                delete item.backup_location_path;
                delete item.backupLocationPath;
              }
              await tx.insert(table).values(mapDates(item)).onConflictDoNothing();
            }
            continue;
          }

          for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500).map(row => {
              const item = { ...row };
              if ('company_id' in item) item.company_id = finalCompanyId;
              if ('companyId' in item) item.companyId = finalCompanyId;
              return mapDates(item);
            });
            try {
              await tx.insert(table).values(chunk).onConflictDoNothing();
            } catch {
              for (const item of chunk) {
                try {
                  await tx.insert(table).values(item).onConflictDoNothing();
                } catch {
                  // Ignore individual constraint errors on restore
                }
              }
            }
          }
        }
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId: finalCompanyId,
        userId: userId && userId !== 'SYSTEM' ? userId : null,
        action: 'RESTORE_COMPLETED',
        entityType: 'company',
        entityId: finalCompanyId,
        metadata: JSON.stringify({ mode, timestamp: new Date().toISOString() })
      });

    });

    // ==========================================
    // 10. POST-EXTRACTION VERIFICATION
    // ==========================================
    try {
      // 1. Verify company profile is readable (both manifest.json on disk and database)
      const manifestPath = path.join(manifest.location, 'manifest.json');
      let localManifest: any;
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        localManifest = JSON.parse(manifestContent);
      } catch (err: any) {
        throw new Error(`Company profile manifest on disk is missing or unreadable: ${err.message}`);
      }

      const companyRows = await targetDb.select().from(schema.companies).where(eq(schema.companies.id, finalCompanyId));
      if (companyRows.length === 0) {
        throw new Error("Company profile row is missing or unreadable from the database.");
      }

      // 2. Verify Company ID matches backup
      if (companyRows[0].id !== finalCompanyId) {
        throw new Error(`Company ID in database (${companyRows[0].id}) does not match the backup ID (${finalCompanyId}).`);
      }
      if (localManifest.id !== finalCompanyId) {
        throw new Error(`Company ID in manifest file (${localManifest.id}) does not match the backup ID (${finalCompanyId}).`);
      }

      // 3. Verify database opens successfully
      try {
        await targetDb.run(sql`SELECT 1;`);
      } catch (dbErr: any) {
        throw new Error(`Database failed to open or execute commands: ${dbErr.message}`);
      }

      // 4. Verify database/schema is compatible
      try {
        await targetDb.run(sql`SELECT COUNT(*) FROM companies;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM accounts;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM accounting_periods;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM journal_entries;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM audit_logs;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM documents;`);
      } catch (schemaErr: any) {
        throw new Error(`Database schema is incompatible or missing required tables: ${schemaErr.message}`);
      }

      // 5. Verify accounting data is accessible
      try {
        const accountsCount = await targetDb.select({ count: sql`count(*)` }).from(schema.accounts);
        console.log(`[Verification] Accounting data accessible. Found ${accountsCount[0]?.count || 0} accounts.`);
      } catch (accountingErr: any) {
        throw new Error(`Accounting data table is inaccessible: ${accountingErr.message}`);
      }

      // 6. Verify required documents/attachments exist on disk
      try {
        const dbDocs = await targetDb.select().from(schema.documents);
        const payloadDocs = finalPayload.data.documents || [];
        const allDocsMap = new Map<string, any>();
        for (const d of dbDocs) allDocsMap.set(d.id, d);
        for (const d of payloadDocs) if (!allDocsMap.has(d.id)) allDocsMap.set(d.id, d);
        const docs = Array.from(allDocsMap.values());

        const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        for (const doc of docs) {
          const ext = path.extname(doc.fileName || '');
          const expectedFilename = `${doc.id}${ext}`;
          const p1 = path.join(targetDocsDir, expectedFilename);
          const p2 = doc.fileName ? path.join(targetDocsDir, doc.fileName) : '';
          const p3 = doc.filePath ? path.join(targetDocsDir, path.basename(doc.filePath)) : '';

          let found = false;
          try { await fs.access(p1); found = true; } catch {}
          if (!found && p2) { try { await fs.access(p2); found = true; } catch {} }
          if (!found && p3) { try { await fs.access(p3); found = true; } catch {} }

          if (!found) {
            throw new Error(`Required document attachment "${doc.fileName}" (ID: ${doc.id}) was not found in physical storage.`);
          }
        }
      } catch (docErr: any) {
        throw new Error(`Documents/attachments verification failed: ${docErr.message}`);
      }

      // 7. Verify audit data exists and is readable
      try {
        const auditCount = await targetDb.select({ count: sql`count(*)` }).from(schema.auditLogs);
        console.log(`[Verification] Audit data accessible. Found ${auditCount[0]?.count || 0} log records.`);
      } catch (auditErr: any) {
        throw new Error(`Audit data table is inaccessible: ${auditErr.message}`);
      }

      // 8. Verify storage configuration is valid (directories exist and are writable)
      try {
        const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        await fs.access(targetDocsDir);
        const tempTestFile = path.join(targetDocsDir, `.write-test-${crypto.randomUUID()}`);
        await fs.writeFile(tempTestFile, "test");
        await fs.unlink(tempTestFile);
      } catch (storageErr: any) {
        throw new Error(`Company storage directories are invalid or unwritable: ${storageErr.message}`);
      }

      // 9. Verify integrity checks pass
      try {
        const dbPath = manifest.dbPath || (fsSync.existsSync(path.join(manifest.location, 'database.lai')) 
          ? path.join(manifest.location, 'database.lai') 
          : path.join(manifest.location, 'database.sqlite'));
        const sqlite = new Database(dbPath);
        const integrity = sqlite.pragma('integrity_check;') as any[];
        if (integrity?.[0] && Object.values(integrity[0])[0] !== 'ok') {
          throw new Error(`SQLite reported status: ${Object.values(integrity[0])[0]}`);
        }
      } catch (integrityErr: any) {
        throw new Error(`Database integrity check failed: ${integrityErr.message}`);
      }

      // ONLY AFTER ALL CHECKS PASS: Register the company in the registry file
      const manifestToRegister: any = {
        id: manifest.id,
        legalName: manifest.legalName,
        createdAt: manifest.createdAt,
        dbPath: manifest.dbPath,
        location: manifest.location,
        backupLocation: manifest.backupLocation,
        status: manifest.status,
        isDemo: manifest.isDemo,
        lastOpenedAt: new Date().toISOString()
      };
      await CompanyManager.registerCompany(manifestToRegister);

    } catch (verErr: any) {
      console.error("[Verification Failed]", verErr);
      try {
        await CompanyManager.unregisterCompany(finalCompanyId);
      } catch (unregErr) {
        // Ignore unregister error if company wasn't registered
      }
      // Clean up folders if it was a NEW restore
      if (mode === 'NEW') {
        try {
          const companyDir = manifest.location;
          await fs.rm(companyDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.error("Failed to clean up company folder after verification failure:", cleanupErr);
        }
      }
      throw new Error(`POST_EXTRACTION_VERIFICATION_FAILED: ${verErr.message}`);
    } finally {
      CompanyManager.removeTempManifest(finalCompanyId);
    }

    return finalCompanyId;
  }

  static async exportBackup(companyId: string): Promise<BackupPayload> {
    const userRows = await db.select().from(schema.users);
    const roleRows = await db.select().from(schema.roles);
    const companyRows = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    const companyLicensesRows = await db.select().from(schema.companyLicenses);
    const companyUsersRows = await db.select().from(schema.companyUsers);
    const taxProfileRows = await db.select().from(schema.companyTaxProfiles);
    const accountingPeriodRows = await db.select().from(schema.accountingPeriods);
    const taxCodeRows = await db.select().from(schema.taxCodes);
    const accountRows = await db.select().from(schema.accounts);
    const vendorRows = await db.select().from(schema.vendors);
    const customerRows = await db.select().from(schema.customers);
    const salesInvoiceRows = await db.select().from(schema.salesInvoices);
    const purchaseBillRows = await db.select().from(schema.purchaseBills);
    const supplierPaymentRows = await db.select().from(schema.supplierPayments);
    const journalEntryRows = await db.select().from(schema.journalEntries);
    const cashTransactionRows = await db.select().from(schema.cashTransactions);
    const cashAdvanceRows = await db.select().from(schema.cashAdvances);
    const taxCalculationRows = await db.select().from(schema.taxCalculations);
    const documentRows = await db.select().from(schema.documents);
    const auditLogRows = await db.select().from(schema.auditLogs);
    
    // Audit Engagements and Related
    const auditEngagementRows = await db.select().from(schema.auditEngagements);
    const engagementIds = auditEngagementRows.map(e => e.id);
    const auditWorkpaperRows = engagementIds.length > 0 ? await db.select().from(schema.auditWorkpapers).where(inArray(schema.auditWorkpapers.engagementId, engagementIds)) : [];
    const auditFindingRows = engagementIds.length > 0 ? await db.select().from(schema.auditFindings).where(inArray(schema.auditFindings.engagementId, engagementIds)) : [];
    const auditAdjustmentRows = engagementIds.length > 0 ? await db.select().from(schema.auditAdjustments).where(inArray(schema.auditAdjustments.engagementId, engagementIds)) : [];
    
    // Approval Workflows
    const approvalWorkflowRequestRows = await db.select().from(schema.approvalWorkflowRequests);

    const journalIds = journalEntryRows.map(j => j.id);
    const journalLineRows = journalIds.length > 0 ? await db.select().from(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, journalIds)) : [];

    const invoiceIds = salesInvoiceRows.map(i => i.id);
    const salesInvoiceLineRows = invoiceIds.length > 0 ? await db.select().from(schema.salesInvoiceLines).where(inArray(schema.salesInvoiceLines.invoiceId, invoiceIds)) : [];

    const billIds = purchaseBillRows.map(b => b.id);
    const purchaseBillLineRows = billIds.length > 0 ? await db.select().from(schema.purchaseBillLines).where(inArray(schema.purchaseBillLines.billId, billIds)) : [];

    const paymentIds = supplierPaymentRows.map(p => p.id);
    const supplierPaymentAppRows = paymentIds.length > 0 ? await db.select().from(schema.supplierPaymentApplications).where(inArray(schema.supplierPaymentApplications.paymentId, paymentIds)) : [];

    const cashTxIds = cashTransactionRows.map(c => c.id);
    const cashTransactionLineRows = cashTxIds.length > 0 ? await db.select().from(schema.cashTransactionLines).where(inArray(schema.cashTransactionLines.cashTransactionId, cashTxIds)) : [];

    const documentFiles: Record<string, string> = {};
    for (const doc of documentRows) {
      try {
        const basename = path.basename(doc.filePath);
        const docPath = await CompanyStorageService.resolveDocumentPath(companyId, basename);
        const fileContent = await fs.readFile(docPath);
        documentFiles[basename] = fileContent.toString('base64');
      } catch (e) {
        console.warn(`File for document ${doc.id} not found or inaccessible:`, e);
      }
    }

    const rawData: Record<string, any[]> = {
      users: userRows,
      roles: roleRows,
      companies: companyRows,
      companyLicenses: companyLicensesRows,
      companyUsers: companyUsersRows,
      companyTaxProfiles: taxProfileRows,
      accountingPeriods: accountingPeriodRows,
      taxCodes: taxCodeRows,
      accounts: accountRows,
      vendors: vendorRows,
      customers: customerRows,
      salesInvoices: salesInvoiceRows,
      salesInvoiceLines: salesInvoiceLineRows,
      purchaseBills: purchaseBillRows,
      purchaseBillLines: purchaseBillLineRows,
      supplierPayments: supplierPaymentRows,
      supplierPaymentApplications: supplierPaymentAppRows,
      journalEntries: journalEntryRows,
      journalLines: journalLineRows,
      cashAdvances: cashAdvanceRows,
      cashTransactions: cashTransactionRows,
      cashTransactionLines: cashTransactionLineRows,
      taxCalculations: taxCalculationRows,
      documents: documentRows,
      auditLogs: auditLogRows,
      auditEngagements: auditEngagementRows,
      auditWorkpapers: auditWorkpaperRows,
      auditFindings: auditFindingRows,
      auditAdjustments: auditAdjustmentRows,
      approvalWorkflowRequests: approvalWorkflowRequestRows,
      documentFiles: documentFiles as any,
    };

    const data = JSON.parse(JSON.stringify(rawData));

    const checksum = this.generateChecksum(data);
    const signature = this.generateSignature(data);
    const companyName = companyRows[0]?.legalName || "Company";

    return {
      metadata: {
        version: "1.0",
        schemaVersion: "1.0",
        format: "LEDGERAI-PH-PROPRIETARY-BACKUP",
        timestamp: new Date().toISOString(),
        companyId,
        companyName,
        checksum,
        signature,
      },
      data,
    };
  }
}

