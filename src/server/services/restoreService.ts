import { db } from '../db';
import { dbContext } from '../db/context';
import * as schema from '../db/schema';
import crypto from 'crypto';
import { inArray, eq, sql } from 'drizzle-orm';
import { CompanyManager } from './companyManager';
import Database from 'better-sqlite3';
import path from 'path';
import zlib from 'zlib';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import { CompanyStorageService } from './storageService';
import { DocumentEncryptionService, DOC_MAGIC } from './documentEncryptionService';
import { DatabaseEncryptionService } from './databaseEncryptionService';
import { AuditService } from './auditService';
import { AuditHmacKeyManager, computeAuditSealHash, computeAuditHmacSignature, normalizeAuditTimestamp } from '../db/auditSeal';
import { paths } from './paths';
import {
  stripPortableSecrets,
  verifyDestinationDiskSpace,
  writePortableMetadataSync,
} from './portableCompanyService';

const BACKUP_SIGNING_KEY_FILENAME = 'backup_signing.key';

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
    documentArchiveMode?: 'INLINE_BASE64' | 'REPOSITORY_DIRECTORY_SNAPSHOT';
    sourceOriginalsDir?: string;
    companionRepoPath?: string;
    auditHmacEnvelope?: any;
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

  static isBackupLocked(companyId: string): boolean {
    return this.activeBackupLocks.has(companyId);
  }

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

  private static async copyDirectoryHardlinkOrCopy(srcDir: string, destDir: string): Promise<void> {
    if (!fsSync.existsSync(srcDir)) return;
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const sPath = path.join(srcDir, entry.name);
      const dPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectoryHardlinkOrCopy(sPath, dPath);
      } else if (entry.isFile()) {
        try {
          await fs.link(sPath, dPath);
        } catch {
          await fs.copyFile(sPath, dPath);
        }
      }
    }
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
      const companyDb = await CompanyManager.getCompanyDb(companyId);
      try {
        await companyDb.run(sql`PRAGMA wal_checkpoint(FULL);`);
        await companyDb.run(sql`PRAGMA integrity_check;`);
      } catch (pragmaErr: any) {
        console.warn("[Backup Safety] SQLite PRAGMA check warning:", pragmaErr.message);
      }

      const payload = await this.exportBackup(companyId);
      const buffer = this.serializeLai(payload);

      const company = await companyDb.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
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

      // If large document repository (>2,500 docs), snapshot the encrypted originals directory alongside the .lai archive
      if (payload.metadata.documentArchiveMode === 'REPOSITORY_DIRECTORY_SNAPSHOT' && payload.metadata.sourceOriginalsDir) {
        const companionRepoPath = `${finalBackupPath}.docs_repo`;
        await fs.rm(companionRepoPath, { recursive: true, force: true }).catch(() => {});
        await this.copyDirectoryHardlinkOrCopy(payload.metadata.sourceOriginalsDir, companionRepoPath);
        payload.metadata.companionRepoPath = companionRepoPath;
      }

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
      let validCreatorId: string | null = null;
      if (userId && userId !== 'SYSTEM') {
        const u = await companyDb.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get();
        if (u) validCreatorId = u.id;
      }
      const isLargeBackup = buffer.length > 5 * 1024 * 1024 || (payload.data.documents?.length || 0) > 2500;
      const dbPayloadJson = isLargeBackup
        ? JSON.stringify({ metadata: payload.metadata, backupPath: finalBackupPath, ExternalArchive: true })
        : JSON.stringify(payload);

      await companyDb.insert(schema.systemBackups).values({
        id: backupId,
        companyId,
        backupName: filename,
        checksum: payload.metadata.checksum,
        sizeBytes: buffer.length,
        passwordProtected: true,
        payloadJson: dbPayloadJson,
        createdBy: validCreatorId
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
        const decodedHeader8 = buf.length >= 8 ? buf.toString('ascii', 0, 8) : '';
        const isRecognizedBase64 =
          header6 === 'LAIPH1' ||
          header6 === 'LGBPH1' ||
          decodedHeader8 === 'LAISENC1' ||
          decodedHeader8 === 'LAISENC2';
        if (buf.length < 14 || !isRecognizedBase64) {
          // If not a recognized base64 container, fall back to binary
          buf = Buffer.from(trimmed, 'binary');
        }
      }
    } else {
      buf = buffer;
    }

    // Reject live encrypted SQLite workspace database containers (LAISENC1 / LAISENC2) in Backup Restore:
    // those are active company workspace files (opened via Open Existing Profile), not exported .lai backup packages.
    const header8 = buf.length >= 8 ? buf.toString('ascii', 0, 8) : '';
    if (header8 === 'LAISENC1' || header8 === 'LAISENC2') {
      throw new Error(
        "WORKSPACE_DB_NOT_BACKUP: Live encrypted workspace database file (LAISENC2) cannot be restored as a backup archive. Use 'Open Existing Profile' to open a company folder directly, or use an exported backup package."
      );
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
      if (metaLen === 0 || buf.length < 14 + metaLen) {
        throw new Error("CORRUPTED_PACKAGE: Metadata block length mismatch.");
      }

      // Read Metadata string
      const metaStr = buf.toString('utf8', 10, 10 + metaLen);
      const metadata = JSON.parse(metaStr);

      // Read Data length
      const dataLen = buf.readUInt32BE(10 + metaLen);
      if (dataLen === 0 || buf.length !== 14 + metaLen + dataLen) {
        throw new Error("CORRUPTED_PACKAGE: Compressed data block length mismatch or truncated container.");
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
      const msg = String(e?.message || '');
      if (
        msg.startsWith("CORRUPTED_PACKAGE") ||
        msg.startsWith("INVALID_BACKUP_FORMAT") ||
        msg.startsWith("INVALID_BACKUP_STRUCTURE") ||
        msg.startsWith("BACKUP_VERSION_INCOMPATIBLE") ||
        msg.startsWith("TAMPER_DETECTED") ||
        msg.startsWith("CHECKSUM_MISMATCH") ||
        msg.startsWith("CROSS_TENANT_CONTAMINATION") ||
        msg.includes("Standard JSON")
      ) {
        throw e;
      }
      throw new Error(`INVALID_BACKUP_STRUCTURE: Failed to unpack the proprietary .lai database package structure: ${e.message}`);
    }
  }

  // Legacy alias for backward compatibility
  static deserializeLgb(buffer: Buffer | string): BackupPayload {
    return this.deserializeLai(buffer);
  }

  private static convertEncryptedSnapshotToBackupPayload(buf: Buffer): BackupPayload {
    const tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lai-restore-snap-'));
    const tempLaiPath = path.join(tempDir, 'snapshot.lai');
    const tempSqlitePath = path.join(tempDir, 'decrypted.sqlite');
    let db: any = null;

    try {
      fsSync.writeFileSync(tempLaiPath, buf);
      const decrypted = DatabaseEncryptionService.decryptDatabaseFileSync(tempLaiPath, tempSqlitePath);
      if (!decrypted || !fsSync.existsSync(tempSqlitePath)) {
        throw new Error('INVALID_BACKUP_FORMAT: Unable to decrypt company database container.');
      }

      db = new Database(tempSqlitePath, { readonly: true });
      const comp = db.prepare("SELECT * FROM companies LIMIT 1").get() as any;
      if (!comp || !comp.id) {
        throw new Error('INVALID_BACKUP_STRUCTURE: No company profile found in encrypted database.');
      }

      const companyId = String(comp.id);
      const legalName = String(comp.legal_name || comp.trade_name || companyId);

      const extractTable = (sqlTable: string): any[] => {
        try {
          const hasTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(sqlTable);
          if (!hasTable) return [];
          const rows = db.prepare(`SELECT * FROM ${sqlTable}`).all() as any[];
          return rows.map((r: any) => {
            const out: any = {};
            for (const [k, v] of Object.entries(r)) {
              const camel = k.replace(/_([a-z0-9])/g, (_, g) => g.toUpperCase());
              out[camel] = v;
            }
            return out;
          });
        } catch {
          return [];
        }
      };

      const tableNames = [
        ['companies', 'companies'],
        ['company_licenses', 'companyLicenses'],
        ['license_redemption_records', 'licenseRedemptionRecords'],
        ['license_audit_logs', 'licenseAuditLogs'],
        ['company_users', 'companyUsers'],
        ['company_user_roles', 'companyUserRoles'],
        ['roles', 'roles'],
        ['users', 'users'],
        ['user_permission_overrides', 'userPermissionOverrides'],
        ['user_module_assignments', 'userModuleAssignments'],
        ['company_tax_profiles', 'companyTaxProfiles'],
        ['accounting_periods', 'accountingPeriods'],
        ['accounts', 'accounts'],
        ['journal_entries', 'journalEntries'],
        ['journal_lines', 'journalLines'],
        ['audit_logs', 'auditLogs'],
        ['customers', 'customers'],
        ['vendors', 'vendors'],
        ['inventory_items', 'inventoryItems'],
        ['sales_invoices', 'salesInvoices'],
        ['sales_invoice_lines', 'salesInvoiceLines'],
        ['purchase_bills', 'purchaseBills'],
        ['purchase_bill_lines', 'purchaseBillLines'],
        ['customer_payments', 'customerPayments'],
        ['supplier_payments', 'supplierPayments'],
        ['documents', 'documents'],
      ];

      const data: Record<string, any[]> = {};
      let totalRecords = 0;
      const recordCounts: Record<string, number> = {};

      for (const [sqlTable, payloadKey] of tableNames) {
        const rows = extractTable(sqlTable);
        data[payloadKey] = rows;
        recordCounts[payloadKey] = rows.length;
        totalRecords += rows.length;
      }

      const dataString = deterministicStringify(data);
      const checksum = crypto.createHash('sha256').update(dataString).digest('hex');
      const signature = this.generateSignature(data);

      const payload: BackupPayload = {
        metadata: {
          version: '1.0',
          companyId,
          companyName: legalName,
          timestamp: new Date().toISOString(),
          checksum,
          signature,
          format: 'LAISENC_CONTAINER',
        },
        data: data as any,
      };

      return this.validateBackupFile(payload);
    } finally {
      try { if (db) db.close(); } catch {}
      try { fsSync.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  private static getBackupSigningKeySync(): Buffer {
    const envSecret = process.env.LEDGERAI_BACKUP_SIGNING_KEY?.trim();
    if (envSecret && envSecret.length >= 16) {
      return crypto.createHash('sha256').update(envSecret, 'utf8').digest();
    }
    const vaultDir = path.join(paths.getConfigDir(), '.keystore_vault');
    const keyPath = path.join(vaultDir, BACKUP_SIGNING_KEY_FILENAME);
    try {
      if (fsSync.existsSync(keyPath)) {
        const raw = fsSync.readFileSync(keyPath, 'utf8').trim();
        const buf = Buffer.from(raw, 'hex');
        if (buf.length === 32) return buf;
      }
    } catch {
      // fall through to provision key cleanly
    }
    fsSync.mkdirSync(vaultDir, { recursive: true });
    const newKey = crypto.randomBytes(32);
    fsSync.writeFileSync(keyPath, newKey.toString('hex'), { mode: 0o600 });
    return newKey;
  }

  static generateSignature(data: any): string {
    const dataString = deterministicStringify(data);
    const signingKey = this.getBackupSigningKeySync();
    return crypto.createHmac('sha256', signingKey).update(dataString).digest('hex');
  }

  static verifySignature(payload: BackupPayload): boolean {
    if (!payload.metadata?.signature || typeof payload.metadata.signature !== 'string') return false;
    const expectedSig = this.generateSignature(payload.data);
    try {
      const providedBuf = Buffer.from(payload.metadata.signature, 'hex');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      if (providedBuf.length !== expectedBuf.length || expectedBuf.length === 0) {
        return false;
      }
      return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
      return false;
    }
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

    // Cryptographic signature is mandatory — unsigned or forged backups are rejected
    if (!payload.metadata.signature || !RestoreService.verifySignature(payload)) {
      throw new Error("TAMPER_DETECTED: Missing or invalid cryptographic backup signature. Backup rejected.");
    }

    // Cross-company / cross-tenant contamination check
    const expectedCompanyId = String(payload.metadata.companyId);
    if (Array.isArray(payload.data.companies)) {
      if (payload.data.companies.length > 1) {
        throw new Error(
          `CROSS_TENANT_CONTAMINATION: Backup package contains ${payload.data.companies.length} company profiles; cross-company contamination is prohibited.`
        );
      }
      for (const compRow of payload.data.companies) {
        if (compRow?.id && String(compRow.id) !== expectedCompanyId) {
          throw new Error(
            `CROSS_TENANT_CONTAMINATION: Backup company profile '${compRow.id}' does not match metadata companyId '${expectedCompanyId}'.`
          );
        }
      }
    }

    for (const [tableKey, rows] of Object.entries(payload.data)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const rowCid = row.companyId ?? row.company_id;
        if (rowCid !== undefined && rowCid !== null && String(rowCid).trim() !== '' && String(rowCid) !== expectedCompanyId) {
          throw new Error(
            `CROSS_TENANT_CONTAMINATION: Backup table '${tableKey}' contains record belonging to foreign company '${rowCid}' instead of '${expectedCompanyId}'.`
          );
        }
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
      'companies',
      'companyLicenses',
      'licenseRedemptionRecords',
      'licenseAuditLogs',
      'companyUsers',
      'companyUserRoles',
      'userPermissionOverrides',
      'userModuleAssignments',
      'userModuleAssignmentHistory',
      'sodRestrictions',
      'companyTaxProfiles',
      'companyBranding',
      'companyAiSettings',
      'notificationPreferences',
      'accountingPeriods',
      'periodStatusHistory',
      'taxCodes',
      'accounts',
      'banks',
      'bankAccounts',
      'bankStatements',
      'departments',
      'projects',
      'costCenters',
      'locations',
      'paymentMethods',
      'currencyExchangeRates',
      'vendors',
      'customers',
      'inventoryItems',
      'fixedAssets',
      'employees',
      'budgets',
      'recurringJournals',
      'cashFlowForecasts',
      'payrollRuns',
      'payrollItems',
      'depreciationSchedules',
      'purchaseRequisitions',
      'purchaseOrders',
      'purchaseOrderLines',
      'goodsReceiptNotes',
      'goodsReceiptLines',
      'salesInvoices',
      'salesInvoiceLines',
      'purchaseBills',
      'purchaseBillLines',
      'supplierPayments',
      'supplierPaymentApplications',
      'customerPayments',
      'customerPaymentApplications',
      'creditMemos',
      'creditMemoLines',
      'creditMemoApplications',
      'debitMemos',
      'debitMemoLines',
      'debitMemoApplications',
      'journalEntries',
      'journalLines',
      'cashAdvances',
      'cashTransactions',
      'cashTransactionLines',
      'checks',
      'bankDeposits',
      'cashCounts',
      'cashCountDenominations',
      'bankReconciliations',
      'bankStatementLines',
      'bankReconciliationAdjustments',
      'bankTransactions',
      'bankReconciliationApprovals',
      'inventoryTransactions',
      'stockAdjustments',
      'fxRevaluationRuns',
      'taxFilings',
      'taxFilingChecklists',
      'taxManualAdjustments',
      'taxExceptions',
      'taxCalendar',
      'electronicFilingSubmissions',
      'statutoryRules',
      'statutoryAuditLogs',
      'taxCalculations',
      'documents',
      'documentVersions',
      'documentOcrHistory',
      'companyDocuments',
      'auditLogs',
      'approvalWorkflowRequests',
      'approvalWorkflows',
      'approvalSteps',
      'approvalIdempotencyKeys',
      'approvalDelegations',
      'auditEngagements',
      'auditEngagementItems',
      'auditEngagementLogs',
      'auditPlanningDocs',
      'auditSignificantAccounts',
      'auditRisksAndProcedures',
      'auditPlanningVersions',
      'auditWorkpapers',
      'auditWorkpaperVersions',
      'auditFindings',
      'auditAdjustments',
      'internalControlsLog',
      'fraudFlags',
      'notifications',
      'aiExecutionLogs',
      'integrityScanReports',
      'integrityScanFindings'
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

  static async restoreDatabase(
    payload: BackupPayload,
    targetCompanyId: string,
    mode: 'NEW' | 'REPLACE',
    userId: string | null = null,
    destinationPath?: string,
    options?: {
      cloneAsNew?: boolean;
      injectFailureStage?: 'AFTER_DISK_BEFORE_TX' | 'BEFORE_COMMIT' | 'POST_VERIFICATION';
      availableBytesOverride?: number;
      minRequiredBytes?: number;
    }
  ): Promise<string> {
    let finalPayload = payload;
    let finalCompanyId = targetCompanyId || payload.metadata.companyId;

    // Pre-flight destination storage verification before mutating disk
    const estimatedDataBytes = Buffer.byteLength(JSON.stringify(payload.data || {}), 'utf8');
    const requiredStorageBytes =
      typeof options?.minRequiredBytes === 'number' && options.minRequiredBytes > 0
        ? options.minRequiredBytes
        : Math.max(estimatedDataBytes * 3, 2 * 1024 * 1024);
    const probeDestinationDir =
      destinationPath && destinationPath.trim()
        ? destinationPath.trim()
        : path.join(paths.getCompaniesRootDir(), finalCompanyId);
    const spaceCheck = await verifyDestinationDiskSpace(
      probeDestinationDir,
      requiredStorageBytes,
      options?.availableBytesOverride
    );
    if (!spaceCheck.sufficient) {
      throw new Error(spaceCheck.message);
    }

    const existingCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    let existingManifest =
      existingCompanies.find((c) => c.id === finalCompanyId) ||
      (await CompanyManager.getCompanyManifest(finalCompanyId).catch(() => null));

    const keyringFilePath = AuditHmacKeyManager.getKeyringFilePath(finalCompanyId);
    let preRestoreSnapshotDir: string | null = null;
    let preRestoreKeyringExisted = false;
    let preRestoreDocsExisted = false;
    let preRestoreDocsDir: string | null = null;

    if (mode === 'NEW') {
      if (options?.cloneAsNew) {
        // Generate fresh unique company ID if caller asked to clone or target ID collides
        if (!targetCompanyId || existingCompanies.some((c) => c.id === finalCompanyId) || finalCompanyId === payload.metadata.companyId) {
          const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
          finalCompanyId = `${payload.metadata.companyId}-RESTORED-${suffix}`;
          existingManifest = undefined;
        }
      } else if (existingManifest) {
        throw new Error(
          `COMPANY_ALREADY_EXISTS: Company '${finalCompanyId}' (${existingManifest.legalName}) already exists locally. Switch to REPLACE mode (signed into that company) or choose Clone as New Company to avoid overwriting active data.`
        );
      }

      if (destinationPath && destinationPath.trim()) {
        const trimmedDest = path.resolve(destinationPath.trim());
        if (fsSync.existsSync(trimmedDest)) {
          const existingItems = fsSync
            .readdirSync(trimmedDest)
            .filter((name) => name !== '.DS_Store' && name !== 'Thumbs.db');
          if (existingItems.length > 0) {
            throw new Error(
              `TARGET_DIRECTORY_NOT_EMPTY: Destination folder '${trimmedDest}' is not empty (${existingItems.length} existing item(s)). Select an empty folder or specify a dedicated company subfolder to avoid overwriting existing files.`
            );
          }
        }
        await CompanyManager.checkDuplicateCompanyConflict({
          targetDir: destinationPath.trim(),
          excludeCompanyId: finalCompanyId,
        });
      }

      const remapped = this.remapUuids(payload, finalCompanyId);
      finalPayload = remapped.payload;
      finalCompanyId = remapped.newCompanyId;
      // Note: remapped auditLogs are sealed atomically in a single deterministic pass inside tx
      // against the persisted rows so timestamps/sequence match SQLite state.
    } else {
      if (payload.metadata.companyId !== targetCompanyId) {
        throw new Error("IDENTITY_MISMATCH: Backup file company ID does not match target company");
      }
      if (payload.data?.companies?.[0]?.id && payload.data.companies[0].id !== targetCompanyId) {
        throw new Error("IDENTITY_MISMATCH: Company ID in database payload does not match target company ID");
      }
      if (existingManifest) {
        try {
          await CompanyManager.syncCompanyDatabaseSnapshot(finalCompanyId);
        } catch {}
        preRestoreSnapshotDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lai-restore-rollback-'));
        for (const fname of ['.db_active.sqlite', 'database.sqlite', 'database.lai', 'manifest.json']) {
          const src = path.join(existingManifest.location, fname);
          if (fsSync.existsSync(src)) {
            fsSync.copyFileSync(src, path.join(preRestoreSnapshotDir, fname));
          }
        }
        preRestoreKeyringExisted = fsSync.existsSync(keyringFilePath);
        if (preRestoreKeyringExisted) {
          fsSync.copyFileSync(keyringFilePath, path.join(preRestoreSnapshotDir, 'audit_hmac.json'));
        }
        preRestoreDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        preRestoreDocsExisted = fsSync.existsSync(preRestoreDocsDir);
        if (preRestoreDocsExisted) {
          await this.copyDirectoryHardlinkOrCopy(preRestoreDocsDir, path.join(preRestoreSnapshotDir, 'documents_bak'));
        }
      }
    }

    // If a custom destination path is provided, create the company profile there
    let companyName = payload.metadata.companyName;
    if (finalPayload.data.companies && finalPayload.data.companies.length > 0) {
      companyName = finalPayload.data.companies[0].legalName || companyName || "Restored Company";
    }

    let manifest: any;
    const existing = existingManifest;
    const resolvedKeyringPath = AuditHmacKeyManager.getKeyringFilePath(finalCompanyId);

    if (destinationPath && destinationPath.trim()) {
      manifest = await CompanyManager.createCompanyProfile(finalCompanyId, companyName || "Restored Company", destinationPath.trim(), undefined, true);
    } else {
      if (!existing) {
        manifest = await CompanyManager.createCompanyProfile(finalCompanyId, companyName || "Restored Company", undefined, undefined, true);
      } else {
        manifest = existing;
      }
    }

    const restorePreReplaceSnapshot = async () => {
      if (!preRestoreSnapshotDir || !fsSync.existsSync(preRestoreSnapshotDir)) return;
      try {
        await CompanyManager.closeCompanyDb(finalCompanyId);
        for (const staleWal of ['.db_active.sqlite-wal', '.db_active.sqlite-shm', 'database.sqlite-wal', 'database.sqlite-shm']) {
          const p = path.join(manifest.location, staleWal);
          if (fsSync.existsSync(p)) {
            fsSync.unlinkSync(p);
          }
        }
        for (const fname of ['.db_active.sqlite', 'database.sqlite', 'database.lai', 'manifest.json']) {
          const bak = path.join(preRestoreSnapshotDir, fname);
          const dst = path.join(manifest.location, fname);
          if (fsSync.existsSync(bak)) {
            fsSync.copyFileSync(bak, dst);
          }
        }
        const keyringBak = path.join(preRestoreSnapshotDir, 'audit_hmac.json');
        if (preRestoreKeyringExisted && fsSync.existsSync(keyringBak)) {
          fsSync.copyFileSync(keyringBak, resolvedKeyringPath);
        } else if (!preRestoreKeyringExisted && fsSync.existsSync(resolvedKeyringPath)) {
          fsSync.unlinkSync(resolvedKeyringPath);
        }
        if (preRestoreDocsDir) {
          await fs.rm(preRestoreDocsDir, { recursive: true, force: true });
          const docsBak = path.join(preRestoreSnapshotDir, 'documents_bak');
          if (preRestoreDocsExisted && fsSync.existsSync(docsBak)) {
            await this.copyDirectoryHardlinkOrCopy(docsBak, preRestoreDocsDir);
          }
        }
      } catch (snapErr) {
        console.error('[Restore Rollback] Failed to restore pre-replace snapshot:', snapErr);
      }
    };

    const cleanupNewModeArtifacts = async () => {
      try { await CompanyManager.closeCompanyDb(finalCompanyId); } catch {}
      try { await CompanyManager.unregisterCompany(finalCompanyId); } catch {}
      try { await fs.rm(manifest.location, { recursive: true, force: true }); } catch {}
      if (!existing && fsSync.existsSync(resolvedKeyringPath)) {
        try { fsSync.unlinkSync(resolvedKeyringPath); } catch {}
      }
    };

    let targetDb: any;
    try {
      if (mode === 'REPLACE' && payload.metadata?.auditHmacEnvelope) {
        AuditHmacKeyManager.importPortableKeyringEnvelopeSync(finalCompanyId, payload.metadata.auditHmacEnvelope, 'Company Owner');
      }

      // Reconstruct valid document file paths for target system
      const docLookupMap = new Map<string, any>();
      if (finalPayload.data.documents) {
        const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        for (const row of finalPayload.data.documents) {
          const oldBasename = row.filePath ? path.basename(row.filePath) : '';
          if (row.fileHash) {
            row.filePath = await CompanyStorageService.resolvePartitionedOriginalPath(
              finalCompanyId,
              row.id,
              row.fileHash,
              row.fileName
            );
          } else {
            const ext = path.extname(row.fileName || '');
            const safeFilename = `${row.id}${ext}`;
            row.filePath = path.join(targetDocsDir, safeFilename);
          }
          if (row.id) docLookupMap.set(row.id, row);
          if (oldBasename) docLookupMap.set(oldBasename, row);
          if (row.filePath) docLookupMap.set(path.basename(row.filePath), row);
          if (row.fileName) docLookupMap.set(row.fileName, row);
        }
      }

      // Write physical documents to disk if present (inline or companion repository snapshot)
      const companionSrcDir =
        finalPayload.metadata.companionRepoPath && fsSync.existsSync(finalPayload.metadata.companionRepoPath)
          ? finalPayload.metadata.companionRepoPath
          : finalPayload.metadata.sourceOriginalsDir && fsSync.existsSync(finalPayload.metadata.sourceOriginalsDir)
            ? finalPayload.metadata.sourceOriginalsDir
            : null;

      if (finalPayload.metadata.documentArchiveMode === 'REPOSITORY_DIRECTORY_SNAPSHOT' && companionSrcDir) {
        const targetOriginalsDir = await CompanyStorageService.getOriginalsPath(finalCompanyId);
        if (path.resolve(companionSrcDir) !== path.resolve(targetOriginalsDir)) {
          await this.copyDirectoryHardlinkOrCopy(companionSrcDir, targetOriginalsDir);
        }
      } else if (finalPayload.data.documentFiles) {
        const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        await fs.mkdir(targetDocsDir, { recursive: true });
        for (const [key, base64Content] of Object.entries(finalPayload.data.documentFiles)) {
          let buf = Buffer.from(base64Content as string, 'base64');
          const matchingDoc = docLookupMap.get(key);

          if (mode === 'NEW' && matchingDoc && buf.length >= 40 && buf.subarray(0, 8).equals(DOC_MAGIC)) {
            try {
              const aadLen = buf.readUInt16BE(38);
              if (buf.length < 40 + aadLen) {
                throw new Error('Truncated LAISDOC1 AAD header in backup attachment.');
              }
              const aadMeta = JSON.parse(buf.subarray(40, 40 + aadLen).toString('utf8'));
              if (!aadMeta || !aadMeta.companyId || !aadMeta.documentId) {
                throw new Error('Missing companyId/documentId in LAISDOC1 AAD metadata.');
              }
              const { plainBuffer, metadata: origMeta } = DocumentEncryptionService.decryptBuffer(
                aadMeta.companyId,
                aadMeta.documentId,
                buf
              );
              const reEncrypted = DocumentEncryptionService.encryptBuffer(
                finalCompanyId,
                matchingDoc.id,
                plainBuffer,
                {
                  originalFileName: origMeta.originalFileName || matchingDoc.originalFileName || matchingDoc.fileName || 'attachment.bin',
                  contentType: origMeta.contentType || matchingDoc.fileType || 'application/octet-stream',
                }
              );
              buf = reEncrypted.encryptedBuffer;
            } catch (reEncErr: any) {
              throw new Error(
                `ATTACHMENT_REENCRYPTION_FAILED: Unable to decrypt and re-encrypt attachment '${matchingDoc.fileName || key}' for restored company '${finalCompanyId}': ${reEncErr?.message || reEncErr}`
              );
            }
          }

          if (matchingDoc && matchingDoc.filePath) {
            await fs.mkdir(path.dirname(matchingDoc.filePath), { recursive: true });
            await fs.writeFile(matchingDoc.filePath, buf);
            // Also keep a copy at legacy targetDocsDir for backwards compatibility with tests
            const legacyPath = path.join(targetDocsDir, `${matchingDoc.id}${path.extname(matchingDoc.fileName || '')}`);
            if (legacyPath !== matchingDoc.filePath) {
              await fs.writeFile(legacyPath, buf).catch(() => {});
            }
          } else {
            const destPath = path.join(targetDocsDir, key);
            await fs.writeFile(destPath, buf);
          }
        }
      }

      if (options?.injectFailureStage === 'AFTER_DISK_BEFORE_TX') {
        throw new Error('INJECTED_RESTORE_FAILURE: Simulated crash after disk extraction before database transaction.');
      }

      targetDb = await CompanyManager.getCompanyDb(finalCompanyId, { allowInitializeNew: true });
    } catch (diskStageErr: any) {
      if (mode === 'REPLACE') {
        await restorePreReplaceSnapshot();
      } else {
        await cleanupNewModeArtifacts();
      }
      if (preRestoreSnapshotDir) {
        try { fsSync.rmSync(preRestoreSnapshotDir, { recursive: true, force: true }); } catch {}
      }
      CompanyManager.removeTempManifest(finalCompanyId);
      throw diskStageErr;
    }

    const numericTimestampFields = new Set([
      'timestamp',
      'transactionDate',
      'statementDate',
      'validFrom',
      'validUntil',
      'forecastDate',
      'nextRunDate',
      'lastRunDate',
      'expiresAt',
      'lockedUntil',
    ]);
    const mapDates = (obj: any, tbl?: any): any => {
      for (const k in obj) {
        const col = tbl?.[k];
        if (col && col.dataType !== 'date') {
          if (obj[k] instanceof Date) {
            obj[k] = col.dataType === 'number' ? obj[k].getTime() : obj[k].toISOString();
          }
          continue;
        }
        if (col && col.dataType === 'date') {
          if (typeof obj[k] === 'number' || typeof obj[k] === 'string') {
            obj[k] = new Date(obj[k]);
          }
          continue;
        }
        if (typeof obj[k] === 'number' && (k.endsWith('At') || numericTimestampFields.has(k))) {
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
      'permissions',
      'rolePermissions',
      'companyLicenses',
      'licenseRedemptionRecords',
      'licenseAuditLogs',
      'companyUsers',
      'companyUserRoles',
      'userPermissionOverrides',
      'userModuleAssignments',
      'userModuleAssignmentHistory',
      'sodRestrictions',
      'companyTaxProfiles',
      'companyBranding',
      'companyAiSettings',
      'notificationPreferences',
      'taxRuleDefinitions',
      'taxRuleVersions',
      'accountingPeriods',
      'periodStatusHistory',
      'taxCodes',
      'accounts',
      'banks',
      'bankAccounts',
      'bankStatements',
      'departments',
      'projects',
      'costCenters',
      'locations',
      'paymentMethods',
      'currencyExchangeRates',
      'vendors',
      'customers',
      'inventoryItems',
      'fixedAssets',
      'employees',
      'birPolicies',
      'atcDefinitions',
      'budgets',
      'recurringJournals',
      'cashFlowForecasts',
      'statutoryTrustAnchors',
      'statutoryUpdatePackages',
      'statutoryRules',
      'statutoryAuditLogs',
      'journalEntries',
      'journalLines',
      'payrollRuns',
      'payrollItems',
      'depreciationSchedules',
      'purchaseRequisitions',
      'purchaseOrders',
      'purchaseOrderLines',
      'goodsReceiptNotes',
      'goodsReceiptLines',
      'salesInvoices',
      'salesInvoiceLines',
      'purchaseBills',
      'purchaseBillLines',
      'supplierPayments',
      'supplierPaymentApplications',
      'customerPayments',
      'customerPaymentApplications',
      'creditMemos',
      'creditMemoLines',
      'creditMemoApplications',
      'debitMemos',
      'debitMemoLines',
      'debitMemoApplications',
      'cashAdvances',
      'cashTransactions',
      'cashTransactionLines',
      'checks',
      'bankDeposits',
      'cashCounts',
      'cashCountDenominations',
      'bankReconciliations',
      'bankStatementLines',
      'bankReconciliationAdjustments',
      'bankTransactions',
      'bankReconciliationApprovals',
      'inventoryTransactions',
      'stockAdjustments',
      'fxRevaluationRuns',
      'taxFilings',
      'taxFilingChecklists',
      'taxManualAdjustments',
      'taxExceptions',
      'taxCalendar',
      'electronicFilingSubmissions',
      'taxCalculations',
      'documents',
      'documentVersions',
      'documentOcrHistory',
      'companyDocuments',
      'auditLogs',
      'approvalWorkflowRequests',
      'approvalWorkflows',
      'approvalSteps',
      'approvalIdempotencyKeys',
      'approvalDelegations',
      'auditEngagements',
      'auditEngagementItems',
      'auditEngagementLogs',
      'auditPlanningDocs',
      'auditSignificantAccounts',
      'auditRisksAndProcedures',
      'auditPlanningVersions',
      'auditWorkpapers',
      'auditWorkpaperVersions',
      'auditFindings',
      'auditAdjustments',
      'internalControlsLog',
      'fraudFlags',
      'notifications',
      'aiExecutionLogs',
      'integrityScanReports',
      'integrityScanFindings'
    ];

    let validRestorerId: string | null = null;
    try {
      await dbContext.run(targetDb, async () => {
        await db.transaction(async (tx: any) => {
          const conflictSafeTables = new Set([
            'companies',
            'companyLicenses',
            'licenseRedemptionRecords',
            'licenseAuditLogs',
            'users',
            'roles',
            'permissions',
            'rolePermissions',
            'companyUsers',
            'companyUserRoles',
            'userPermissionOverrides',
            'userModuleAssignments',
            'userModuleAssignmentHistory',
            'sodRestrictions',
            'taxRuleDefinitions',
            'taxRuleVersions',
            'statutoryTrustAnchors',
            'statutoryUpdatePackages',
            'birPolicies',
            'atcDefinitions'
          ]);

          if (mode === 'REPLACE' || mode === 'NEW') {
            // Authorized disaster-recovery replace must clear and re-seed audit_logs atomically inside the transaction,
            // then immediately re-arm both immutability triggers before commit.
            await tx.run(sql.raw(`DROP TRIGGER IF EXISTS trg_audit_logs_immutable_update;`));
            await tx.run(sql.raw(`DROP TRIGGER IF EXISTS trg_audit_logs_immutable_delete;`));
            const deleteIgnoringMissingTable = async (tbl: any) => {
              if (!tbl) return;
              try {
                await tx.delete(tbl);
              } catch (delErr: any) {
                if (!String(delErr?.message || '').includes('no such table')) {
                  throw delErr;
                }
              }
            };
            await deleteIgnoringMissingTable(schema.journalLines);
            await deleteIgnoringMissingTable(schema.salesInvoiceLines);
            await deleteIgnoringMissingTable(schema.purchaseBillLines);
            await deleteIgnoringMissingTable(schema.supplierPaymentApplications);
            await deleteIgnoringMissingTable(schema.customerPaymentApplications);
            await deleteIgnoringMissingTable(schema.cashTransactionLines);

            // Clear optional child history tables that may reference documents or auditEngagements
            for (const optionalChild of [
              schema.documentVersions,
              schema.documentOcrHistory,
              schema.auditWorkpaperVersions,
              schema.auditEngagementItems,
              schema.auditEngagementLogs,
              schema.auditPlanningDocs,
              schema.auditSignificantAccounts,
              schema.auditRisksAndProcedures,
              schema.auditPlanningVersions,
            ]) {
              await deleteIgnoringMissingTable(optionalChild);
            }

            const reverseOrder = [...explicitOrder].reverse();
            for (const key of reverseOrder) {
              if (!conflictSafeTables.has(key)) {
                const table = (schema as any)[key];
                if (!table) {
                  throw new Error(`MISSING_SCHEMA_TABLE_MAPPING: Restore ordering table '${key}' has no Drizzle schema mapping.`);
                }
                await deleteIgnoringMissingTable(table);
              }
            }
            if (mode === 'REPLACE' && finalPayload.data?.companyLicenses?.length > 0) {
              await deleteIgnoringMissingTable(schema.companyLicenses);
            }
          }

          for (const key of explicitOrder) {
            if (finalPayload.data[key] && finalPayload.data[key].length > 0) {
              const table = (schema as any)[key];
              if (!table) {
                throw new Error(`MISSING_SCHEMA_TABLE_MAPPING: Restore payload contains table '${key}' with no Drizzle schema mapping.`);
              }
              let rows = finalPayload.data[key];
              if (key === 'accounts') {
                const byId = new Map(rows.map((r: any) => [r.id, r]));
                const ordered: any[] = [];
                const visited = new Set<string>();
                const visit = (r: any) => {
                  if (!r || visited.has(r.id)) return;
                  const pid = r.parentAccountId ?? r.parent_account_id;
                  if (pid && byId.has(pid)) visit(byId.get(pid));
                  visited.add(r.id);
                  ordered.push(r);
                };
                for (const r of rows) visit(r);
                rows = ordered;
              }

              if (key === 'companies' || key === 'companyLicenses') {
                // Important: A cloned company (finalCompanyId !== original metadata companyId) must never inherit
                // the source company's paid dual-file license or redemption records.
                if (key === 'companyLicenses' && finalCompanyId !== payload.metadata.companyId) {
                  continue;
                }
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
                  await tx.insert(table).values(mapDates(item, table)).onConflictDoNothing();
                }
                continue;
              }
              if (key === 'licenseRedemptionRecords' && finalCompanyId !== payload.metadata.companyId) {
                continue;
              }

              for (let i = 0; i < rows.length; i += 500) {
                const chunk = rows.slice(i, i + 500).map(row => {
                  const item = { ...row };
                  if ('company_id' in item) item.company_id = finalCompanyId;
                  if ('companyId' in item) item.companyId = finalCompanyId;
                  return mapDates(item, table);
                });
                if (conflictSafeTables.has(key)) {
                  await tx.insert(table).values(chunk).onConflictDoNothing();
                } else {
                  await tx.insert(table).values(chunk);
                }
              }
            }
          }

          if (mode === 'NEW') {
            const persistedAuditRows = await tx
              .select()
              .from(schema.auditLogs)
              .where(eq(schema.auditLogs.companyId, finalCompanyId))
              .orderBy(sql`rowid ASC`);
            if (persistedAuditRows.length > 0) {
              const signingKey = AuditHmacKeyManager.getActiveSigningKeySync(finalCompanyId, 'SYSTEM_AUDIT_SEALER');
              let seq = 0;
              let prevHash = 'GENESIS';
              for (const dbRow of persistedAuditRows) {
                seq += 1;
                const chainVersion = 2;
                const sequenceNumber = seq;
                const previousHash = prevHash;
                const tsIso = normalizeAuditTimestamp(dbRow.timestamp).toISOString();
                const integritySeal = computeAuditSealHash({
                  id: dbRow.id,
                  companyId: dbRow.companyId,
                  userId: dbRow.userId,
                  userDisplayName: dbRow.userDisplayName,
                  userEmail: dbRow.userEmail,
                  role: dbRow.role,
                  action: dbRow.action,
                  entityType: dbRow.entityType,
                  entityId: dbRow.entityId,
                  recordReference: dbRow.recordReference,
                  beforeData: dbRow.beforeData,
                  afterData: dbRow.afterData,
                  changedFields: dbRow.changedFields,
                  result: dbRow.result || 'SUCCESS',
                  ipAddress: dbRow.ipAddress,
                  timestampIso: tsIso,
                  chainVersion,
                  sequenceNumber,
                  previousHash,
                });
                const hmacSeal = computeAuditHmacSignature({
                  integritySeal,
                  companyId: finalCompanyId,
                  sequenceNumber,
                  previousHash,
                  keyVersion: signingKey.keyVersion,
                  secret: signingKey.secret,
                });
                let metaObj: Record<string, any> = {};
                if (dbRow.metadata) {
                  try {
                    metaObj = typeof dbRow.metadata === 'string' ? JSON.parse(dbRow.metadata) : { ...dbRow.metadata };
                  } catch {
                    metaObj = {};
                  }
                }
                metaObj.chainVersion = chainVersion;
                metaObj.sequenceNumber = sequenceNumber;
                metaObj.previousHash = previousHash;
                metaObj.integritySeal = integritySeal;
                metaObj.hmacKeyId = signingKey.keyId;
                metaObj.hmacKeyVersion = signingKey.keyVersion;
                metaObj.hmacSeal = hmacSeal;
                await tx
                  .update(schema.auditLogs)
                  .set({ metadata: JSON.stringify(metaObj) })
                  .where(eq(schema.auditLogs.id, dbRow.id));
                prevHash = integritySeal;
              }
            }
          }

          await tx.run(sql.raw(`
            CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_update
            BEFORE UPDATE ON audit_logs
            BEGIN
              SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be updated.');
            END;
          `));
          await tx.run(sql.raw(`
            CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_delete
            BEFORE DELETE ON audit_logs
            BEGIN
              SELECT RAISE(ABORT, 'SECURITY_VIOLATION: Audit trail records are strictly immutable and cannot be deleted.');
            END;
          `));

          if (userId && userId !== 'SYSTEM') {
            const u = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get();
            if (u) validRestorerId = u.id;
          }

          if (options?.injectFailureStage === 'BEFORE_COMMIT') {
            throw new Error('INJECTED_RESTORE_FAILURE: Simulated mid-transaction crash before SQLite commit.');
          }
        });

        await AuditService.log({
          companyId: finalCompanyId,
          userId: validRestorerId,
          action: 'RESTORE_COMPLETED',
          entityType: 'company',
          entityId: finalCompanyId,
          afterData: { mode, timestamp: new Date().toISOString() }
        });
      });
    } catch (txErr: any) {
      if (mode === 'REPLACE') {
        await restorePreReplaceSnapshot();
      } else {
        await cleanupNewModeArtifacts();
      }
      if (preRestoreSnapshotDir) {
        try { fsSync.rmSync(preRestoreSnapshotDir, { recursive: true, force: true }); } catch {}
      }
      CompanyManager.removeTempManifest(finalCompanyId);
      throw txErr;
    }

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

      // 4. Upgrade restored schema (handles legacy LGBPH1 backups) and verify schema/foreign-key/trigger integrity
      try {
        const { MigrationManager } = await import('./migrationManager');
        const restoredSqlite = await CompanyManager.getCompanySqlite(finalCompanyId);
        if (restoredSqlite) {
          MigrationManager.applyAllMigrations(restoredSqlite, finalCompanyId);
          const schemaCheck = MigrationManager.validateSchemaIntegrity(restoredSqlite);
          if (!schemaCheck.valid) {
            throw new Error(`Foreign key integrity check failed: ${JSON.stringify(schemaCheck.foreignKeyIssues.slice(0, 5))}`);
          }
          const triggers = restoredSqlite
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_audit_logs_immutable_update', 'trg_audit_logs_immutable_delete')")
            .all() as Array<{ name: string }>;
          if (triggers.length < 2) {
            throw new Error('Audit immutability triggers are missing on restored database.');
          }
        }
        await targetDb.run(sql`SELECT COUNT(*) FROM companies;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM accounts;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM accounting_periods;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM journal_entries;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM audit_logs;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM documents;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM bank_reconciliations;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM purchase_requisitions;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM approval_workflows;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM approval_steps;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM approval_idempotency_keys;`);
        await targetDb.run(sql`SELECT COUNT(*) FROM fx_revaluation_runs;`);
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

      // 6. Verify required documents/attachments exist on disk and pass LAISDOC1 cryptographic integrity
      try {
        const dbDocs = await targetDb.select().from(schema.documents);
        const payloadDocs = finalPayload.data.documents || [];
        const allDocsMap = new Map<string, any>();
        for (const d of dbDocs) allDocsMap.set(d.id, d);
        for (const d of payloadDocs) if (!allDocsMap.has(d.id)) allDocsMap.set(d.id, d);
        const docs = Array.from(allDocsMap.values());

        const targetDocsDir = await CompanyStorageService.getDocumentsPath(finalCompanyId);
        const VERIFY_BATCH = 256;
        for (let i = 0; i < docs.length; i += VERIFY_BATCH) {
          const batch = docs.slice(i, i + VERIFY_BATCH);
          await Promise.all(
            batch.map(async (doc) => {
              const ext = path.extname(doc.fileName || '');
              const expectedFilename = `${doc.id}${ext}`;
              const candidates = [
                doc.filePath || '',
                path.join(targetDocsDir, expectedFilename),
                doc.fileName ? path.join(targetDocsDir, doc.fileName) : '',
                doc.filePath ? path.join(targetDocsDir, path.basename(doc.filePath)) : '',
              ].filter((c) => Boolean(c));

              const matchedPath = candidates.find((c) => fsSync.existsSync(c));
              if (!matchedPath) {
                throw new Error(`Required document attachment "${doc.fileName}" (ID: ${doc.id}) was not found in physical storage.`);
              }

              if (await DocumentEncryptionService.isEncryptedContainer(matchedPath)) {
                const check = await DocumentEncryptionService.verifyDocumentIntegrity(
                  finalCompanyId,
                  doc.id,
                  matchedPath,
                  doc.fileHash || undefined
                );
                if (!check.valid) {
                  throw new Error(`LAISDOC1 integrity check failed for document "${doc.fileName}" (${doc.id}): ${check.error}`);
                }
              }
            })
          );
        }
      } catch (docErr: any) {
        throw new Error(`Documents/attachments verification failed: ${docErr.message}`);
      }

      // 7. Verify audit data exists and hash/HMAC chain verifies end-to-end
      try {
        const auditCount = await targetDb.select({ count: sql`count(*)` }).from(schema.auditLogs);
        const chainVerification = await dbContext.run(targetDb, () => AuditService.verifyAuditChain(finalCompanyId));
        if (!chainVerification.verified) {
          throw new Error(
            `Audit chain integrity check failed (${chainVerification.anomalies.length} anomalies): ${chainVerification.anomalies[0]?.details || 'CHAIN_BROKEN'}`
          );
        }
        console.log(`[Verification] Audit data verified (${auditCount[0]?.count || 0} log records, v2ChainedLogs=${chainVerification.v2ChainedLogs}).`);
      } catch (auditErr: any) {
        throw new Error(`Audit data verification failed: ${auditErr.message}`);
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

      // 9. Verify integrity checks pass and sync encrypted .lai snapshot
      try {
        const cachedSqlite = await CompanyManager.getCompanySqlite(finalCompanyId);
        if (cachedSqlite) {
          try {
            cachedSqlite.pragma('wal_checkpoint(TRUNCATE)');
          } catch {
            cachedSqlite.pragma('wal_checkpoint(FULL)');
          }
          const integrity = cachedSqlite.pragma('integrity_check;') as any[];
          if (integrity?.[0] && Object.values(integrity[0])[0] !== 'ok') {
            throw new Error(`SQLite reported status: ${Object.values(integrity[0])[0]}`);
          }
        } else {
          const activeSqlitePath = path.join(manifest.location, '.db_active.sqlite');
          const checkPath = fsSync.existsSync(activeSqlitePath)
            ? activeSqlitePath
            : path.join(manifest.location, 'database.sqlite');
          const sqlite = new Database(checkPath);
          try {
            sqlite.pragma('wal_checkpoint(TRUNCATE)');
            const integrity = sqlite.pragma('integrity_check;') as any[];
            if (integrity?.[0] && Object.values(integrity[0])[0] !== 'ok') {
              throw new Error(`SQLite reported status: ${Object.values(integrity[0])[0]}`);
            }
          } finally {
            sqlite.close();
          }
        }
        await CompanyManager.syncCompanyDatabaseSnapshot(finalCompanyId);
        const snapshotCheck = await CompanyManager.verifySnapshotConsistency(finalCompanyId);
        if (!snapshotCheck.valid) {
          throw new Error(`Post-restore snapshot verification failed: ${snapshotCheck.details}`);
        }
      } catch (integrityErr: any) {
        throw new Error(`Database integrity check failed: ${integrityErr.message}`);
      }

      if (options?.injectFailureStage === 'POST_VERIFICATION') {
        throw new Error('INJECTED_RESTORE_FAILURE: Simulated failure during post-extraction verification.');
      }

      // ONLY AFTER ALL CHECKS PASS: Stamp standardized portable_meta.json, register company, and record Persistent Shortcut History
      const nowIso = new Date().toISOString();
      const { MigrationManager } = await import('./migrationManager');
      const { DatabaseEncryptionService } = await import('./databaseEncryptionService');
      const containerMeta = DatabaseEncryptionService.inspectContainerMetadataSync(manifest.dbPath);
      const restoredSqliteForMeta = await CompanyManager.getCompanySqlite(finalCompanyId).catch(() => null);
      const schemaVerForMeta = restoredSqliteForMeta
        ? MigrationManager.getCurrentVersion(restoredSqliteForMeta)
        : MigrationManager.LATEST_VERSION;
      const restoredDocCount = Array.isArray(finalPayload.data?.documents) ? finalPayload.data.documents.length : 0;

      const portableMetadata = writePortableMetadataSync({
        companyDirectory: manifest.location,
        companyId: finalCompanyId,
        legalName: companyName || manifest.legalName,
        dbPath: manifest.dbPath,
        schemaVersion: schemaVerForMeta,
        encryptionFormat: containerMeta.containerVersion === 'LAISENC2' ? 'LAISENC2' : 'LAISENC1',
        encryptionKeyRef: manifest.keyId || manifest.encryptionKeyMode || containerMeta.keyMode || null,
        attachmentCount: restoredDocCount,
        createdAt: manifest.createdAt || nowIso,
        restoredFromBackupChecksum: payload.metadata.checksum,
      });

      const latestManifest = (await CompanyManager.getCompanyManifest(finalCompanyId)) || manifest;
      const manifestToRegister: any = {
        ...latestManifest,
        id: latestManifest.id,
        legalName: companyName || latestManifest.legalName,
        createdAt: latestManifest.createdAt,
        dbPath: latestManifest.dbPath,
        location: latestManifest.location,
        documentLocation: latestManifest.documentLocation || path.join(latestManifest.location, 'documents'),
        backupLocation: latestManifest.backupLocation || path.join(latestManifest.location, 'backups'),
        status: latestManifest.status,
        isDemo: latestManifest.isDemo,
        lastOpenedAt: nowIso,
        portableMetadata,
      };
      await fs
        .writeFile(
          path.join(manifest.location, 'manifest.json'),
          JSON.stringify(stripPortableSecrets(manifestToRegister), null, 2)
        )
        .catch(() => {});
      await CompanyManager.registerCompany(manifestToRegister);

      try {
        const { CompanyLifecycleService } = await import('./companyLifecycleService');
        const schemaVer = schemaVerForMeta;
        await CompanyLifecycleService.recordShortcut({
          companyId: finalCompanyId,
          displayName: manifestToRegister.legalName,
          databasePath: manifestToRegister.dbPath,
          companyDirectory: manifestToRegister.location,
          databaseIdentity: finalCompanyId,
          lastOperation: 'RESTORED',
          lastOpenedAt: nowIso,
          availabilityStatus: 'AVAILABLE',
          validationStatus: 'VALID',
          classification: manifestToRegister.classification,
          isDemo: manifestToRegister.isDemo,
          isVisualStressPreview: manifestToRegister.isVisualStressPreview,
          versionMetadata: {
            schemaVersion: schemaVer,
            latestSupportedVersion: MigrationManager.LATEST_VERSION,
            containerFormat: containerMeta.containerVersion === 'LAISENC2' ? 'LAISENC2' : 'LAISENC1',
            keyMode: manifestToRegister.encryptionKeyMode || containerMeta.keyMode,
          },
          lastValidationError: null,
        });
      } catch {}

    } catch (verErr: any) {
      console.error("[Verification Failed]", verErr);
      if (mode === 'REPLACE') {
        await restorePreReplaceSnapshot();
      } else {
        await cleanupNewModeArtifacts();
      }
      throw new Error(`POST_EXTRACTION_VERIFICATION_FAILED: ${verErr.message}`);
    } finally {
      if (preRestoreSnapshotDir) {
        try { fsSync.rmSync(preRestoreSnapshotDir, { recursive: true, force: true }); } catch {}
      }
      CompanyManager.removeTempManifest(finalCompanyId);
    }

    return finalCompanyId;
  }

  static async exportBackup(companyId: string): Promise<BackupPayload> {
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    return dbContext.run(companyDb, async () => {
      const userRows = await db.select().from(schema.users);
      const roleRows = await db.select().from(schema.roles);
      const permissionRows = await db.select().from(schema.permissions);
      const rolePermissionRows = await db.select().from(schema.rolePermissions);
      const companyRows = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
      const companyLicensesRows = await db.select().from(schema.companyLicenses);
      const companyUsersRows = await db.select().from(schema.companyUsers);
      const companyUserRolesRows = await db.select().from(schema.companyUserRoles);
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
      const auditLogRows = await db.select().from(schema.auditLogs).orderBy(sql`rowid ASC`);
      
      // Audit Engagements and Related
      const auditEngagementRows = await db.select().from(schema.auditEngagements);
      const engagementIds = auditEngagementRows.map(e => e.id);
      const auditWorkpaperRows = engagementIds.length > 0
        ? (engagementIds.length <= 900
            ? await db.select().from(schema.auditWorkpapers).where(inArray(schema.auditWorkpapers.engagementId, engagementIds))
            : await db.select().from(schema.auditWorkpapers))
        : [];
      const auditFindingRows = engagementIds.length > 0
        ? (engagementIds.length <= 900
            ? await db.select().from(schema.auditFindings).where(inArray(schema.auditFindings.engagementId, engagementIds))
            : await db.select().from(schema.auditFindings))
        : [];
      const auditAdjustmentRows = engagementIds.length > 0
        ? (engagementIds.length <= 900
            ? await db.select().from(schema.auditAdjustments).where(inArray(schema.auditAdjustments.engagementId, engagementIds))
            : await db.select().from(schema.auditAdjustments))
        : [];
      
      // Approval Workflows
      const approvalWorkflowRequestRows = await db.select().from(schema.approvalWorkflowRequests);

      const journalIds = journalEntryRows.map(j => j.id);
      const journalLineRows = journalIds.length > 0
        ? (journalIds.length <= 900
            ? await db.select().from(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, journalIds))
            : await db.select().from(schema.journalLines))
        : [];

      const invoiceIds = salesInvoiceRows.map(i => i.id);
      const salesInvoiceLineRows = invoiceIds.length > 0
        ? (invoiceIds.length <= 900
            ? await db.select().from(schema.salesInvoiceLines).where(inArray(schema.salesInvoiceLines.invoiceId, invoiceIds))
            : await db.select().from(schema.salesInvoiceLines))
        : [];

      const billIds = purchaseBillRows.map(b => b.id);
      const purchaseBillLineRows = billIds.length > 0
        ? (billIds.length <= 900
            ? await db.select().from(schema.purchaseBillLines).where(inArray(schema.purchaseBillLines.billId, billIds))
            : await db.select().from(schema.purchaseBillLines))
        : [];

      const paymentIds = supplierPaymentRows.map(p => p.id);
      const supplierPaymentAppRows = paymentIds.length > 0
        ? (paymentIds.length <= 900
            ? await db.select().from(schema.supplierPaymentApplications).where(inArray(schema.supplierPaymentApplications.paymentId, paymentIds))
            : await db.select().from(schema.supplierPaymentApplications))
        : [];

      const cashTxIds = cashTransactionRows.map(c => c.id);
      const cashTransactionLineRows = cashTxIds.length > 0
        ? (cashTxIds.length <= 900
            ? await db.select().from(schema.cashTransactionLines).where(inArray(schema.cashTransactionLines.cashTransactionId, cashTxIds))
            : await db.select().from(schema.cashTransactionLines))
        : [];

      const documentFiles: Record<string, string> = {};
      const useDirectorySnapshot = documentRows.length > 2500;
      let sourceOriginalsDir: string | undefined;

      if (useDirectorySnapshot) {
        sourceOriginalsDir = await CompanyStorageService.getOriginalsPath(companyId);
      } else {
        for (const doc of documentRows) {
          try {
            let fileContent: Buffer | null = null;
            try {
              if (doc.filePath) {
                fileContent = await fs.readFile(doc.filePath);
              }
            } catch {}

            if (!fileContent) {
              const basename = path.basename(doc.filePath);
              const docPath = await CompanyStorageService.resolveDocumentPath(companyId, basename);
              fileContent = await fs.readFile(docPath);
            }

            if (fileContent) {
              const basename = path.basename(doc.filePath);
              const b64 = fileContent.toString('base64');
              documentFiles[basename] = b64;
              // Also index by doc.id for unambiguous lookup
              if (doc.id && doc.id !== basename) {
                documentFiles[doc.id] = b64;
              }
            }
          } catch (e) {
            console.warn(`File for document ${doc.id} not found or inaccessible:`, e);
          }
        }
      }

      const safeSelectAll = async (tbl: any): Promise<any[]> => {
        if (!tbl) {
          throw new Error('MISSING_SCHEMA_TABLE_MAPPING: Attempted to export backup from an undefined schema table.');
        }
        try {
          return await db.select().from(tbl);
        } catch (err: any) {
          if (String(err?.message || '').includes('no such table')) {
            return [];
          }
          throw err;
        }
      };

      const userPermissionOverrideRows = await safeSelectAll(schema.userPermissionOverrides);
      const userModuleAssignmentRows = await safeSelectAll(schema.userModuleAssignments);
      const userModuleAssignmentHistoryRows = await safeSelectAll(schema.userModuleAssignmentHistory);
      const sodRestrictionRows = await safeSelectAll(schema.sodRestrictions);
      const companyBrandingRows = await safeSelectAll(schema.companyBranding);
      const companyAiSettingsRows = await safeSelectAll(schema.companyAiSettings);
      const notificationPreferenceRows = await safeSelectAll(schema.notificationPreferences);
      const taxRuleDefinitionRows = await safeSelectAll(schema.taxRuleDefinitions);
      const taxRuleVersionRows = await safeSelectAll(schema.taxRuleVersions);
      const periodStatusHistoryRows = await safeSelectAll(schema.periodStatusHistory);
      const bankRows = await safeSelectAll(schema.banks);
      const bankAccountRows = await safeSelectAll(schema.bankAccounts);
      const bankStatementRows = await safeSelectAll(schema.bankStatements);
      const bankTransactionRows = await safeSelectAll(schema.bankTransactions);
      const bankReconciliationApprovalRows = await safeSelectAll(schema.bankReconciliationApprovals);
      const departmentRows = await safeSelectAll(schema.departments);
      const projectRows = await safeSelectAll(schema.projects);
      const costCenterRows = await safeSelectAll(schema.costCenters);
      const locationRows = await safeSelectAll(schema.locations);
      const paymentMethodRows = await safeSelectAll(schema.paymentMethods);
      const currencyExchangeRateRows = await safeSelectAll(schema.currencyExchangeRates);
      const inventoryItemRows = await safeSelectAll(schema.inventoryItems);
      const inventoryTransactionRows = await safeSelectAll(schema.inventoryTransactions);
      const stockAdjustmentRows = await safeSelectAll(schema.stockAdjustments);
      const fixedAssetRows = await safeSelectAll(schema.fixedAssets);
      const depreciationScheduleRows = await safeSelectAll(schema.depreciationSchedules);
      const employeeRows = await safeSelectAll(schema.employees);
      const payrollRunRows = await safeSelectAll(schema.payrollRuns);
      const payrollItemRows = await safeSelectAll(schema.payrollItems);
      const birPolicyRows = await safeSelectAll(schema.birPolicies);
      const atcDefinitionRows = await safeSelectAll(schema.atcDefinitions);
      const budgetRows = await safeSelectAll(schema.budgets);
      const recurringJournalRows = await safeSelectAll(schema.recurringJournals);
      const cashFlowForecastRows = await safeSelectAll(schema.cashFlowForecasts);
      const purchaseRequisitionRows = await safeSelectAll(schema.purchaseRequisitions);
      const purchaseOrderRows = await safeSelectAll(schema.purchaseOrders);
      const purchaseOrderLineRows = await safeSelectAll(schema.purchaseOrderLines);
      const goodsReceiptNoteRows = await safeSelectAll(schema.goodsReceiptNotes);
      const goodsReceiptLineRows = await safeSelectAll(schema.goodsReceiptLines);
      const customerPaymentRows = await safeSelectAll(schema.customerPayments);
      const customerPaymentAppRows = await safeSelectAll(schema.customerPaymentApplications);
      const creditMemoRows = await safeSelectAll(schema.creditMemos);
      const creditMemoLineRows = await safeSelectAll(schema.creditMemoLines);
      const creditMemoAppRows = await safeSelectAll(schema.creditMemoApplications);
      const debitMemoRows = await safeSelectAll(schema.debitMemos);
      const debitMemoLineRows = await safeSelectAll(schema.debitMemoLines);
      const debitMemoAppRows = await safeSelectAll(schema.debitMemoApplications);
      const checkRows = await safeSelectAll(schema.checks);
      const bankDepositRows = await safeSelectAll(schema.bankDeposits);
      const cashCountRows = await safeSelectAll(schema.cashCounts);
      const cashCountDenominationRows = await safeSelectAll(schema.cashCountDenominations);
      const bankReconciliationRows = await safeSelectAll(schema.bankReconciliations);
      const bankStatementLineRows = await safeSelectAll(schema.bankStatementLines);
      const bankReconciliationAdjustmentRows = await safeSelectAll(schema.bankReconciliationAdjustments);
      const fxRevaluationRunRows = await safeSelectAll(schema.fxRevaluationRuns);
      const taxFilingRows = await safeSelectAll(schema.taxFilings);
      const taxFilingChecklistRows = await safeSelectAll(schema.taxFilingChecklists);
      const taxManualAdjustmentRows = await safeSelectAll(schema.taxManualAdjustments);
      const taxExceptionRows = await safeSelectAll(schema.taxExceptions);
      const taxCalendarRows = await safeSelectAll(schema.taxCalendar);
      const electronicFilingSubmissionRows = await safeSelectAll(schema.electronicFilingSubmissions);
      const statutoryTrustAnchorRows = await safeSelectAll(schema.statutoryTrustAnchors);
      const statutoryUpdatePackageRows = await safeSelectAll(schema.statutoryUpdatePackages);
      const statutoryRuleRows = await safeSelectAll(schema.statutoryRules);
      const statutoryAuditLogRows = await safeSelectAll(schema.statutoryAuditLogs);
      const documentVersionRows = await safeSelectAll(schema.documentVersions);
      const documentOcrHistoryRows = await safeSelectAll(schema.documentOcrHistory);
      const companyDocumentRows = await safeSelectAll(schema.companyDocuments);
      const approvalWorkflowRows = await safeSelectAll(schema.approvalWorkflows);
      const approvalStepRows = await safeSelectAll(schema.approvalSteps);
      const approvalIdempotencyKeyRows = await safeSelectAll(schema.approvalIdempotencyKeys);
      const approvalDelegationRows = await safeSelectAll(schema.approvalDelegations);
      const auditEngagementItemRows = await safeSelectAll(schema.auditEngagementItems);
      const auditEngagementLogRows = await safeSelectAll(schema.auditEngagementLogs);
      const auditPlanningDocRows = await safeSelectAll(schema.auditPlanningDocs);
      const auditSignificantAccountRows = await safeSelectAll(schema.auditSignificantAccounts);
      const auditRisksAndProcedureRows = await safeSelectAll(schema.auditRisksAndProcedures);
      const auditPlanningVersionRows = await safeSelectAll(schema.auditPlanningVersions);
      const auditWorkpaperVersionRows = await safeSelectAll(schema.auditWorkpaperVersions);
      const internalControlsLogRows = await safeSelectAll(schema.internalControlsLog);
      const fraudFlagRows = await safeSelectAll(schema.fraudFlags);
      const notificationRows = await safeSelectAll(schema.notifications);
      const aiExecutionLogRows = await safeSelectAll(schema.aiExecutionLogs);
      const integrityScanReportRows = await safeSelectAll(schema.integrityScanReports);
      const integrityScanFindingRows = await safeSelectAll(schema.integrityScanFindings);
      const licenseRedemptionRecordRows = await safeSelectAll(schema.licenseRedemptionRecords);
      const licenseAuditLogRows = await safeSelectAll(schema.licenseAuditLogs);

      const rawData: Record<string, any[]> = {
        users: userRows,
        roles: roleRows,
        permissions: permissionRows,
        rolePermissions: rolePermissionRows,
        companies: companyRows,
        companyLicenses: companyLicensesRows,
        licenseRedemptionRecords: licenseRedemptionRecordRows,
        licenseAuditLogs: licenseAuditLogRows,
        companyUsers: companyUsersRows,
        companyUserRoles: companyUserRolesRows,
        userPermissionOverrides: userPermissionOverrideRows,
        userModuleAssignments: userModuleAssignmentRows,
        userModuleAssignmentHistory: userModuleAssignmentHistoryRows,
        sodRestrictions: sodRestrictionRows,
        companyTaxProfiles: taxProfileRows,
        companyBranding: companyBrandingRows,
        companyAiSettings: companyAiSettingsRows,
        notificationPreferences: notificationPreferenceRows,
        taxRuleDefinitions: taxRuleDefinitionRows,
        taxRuleVersions: taxRuleVersionRows,
        accountingPeriods: accountingPeriodRows,
        periodStatusHistory: periodStatusHistoryRows,
        taxCodes: taxCodeRows,
        accounts: accountRows,
        banks: bankRows,
        bankAccounts: bankAccountRows,
        bankStatements: bankStatementRows,
        departments: departmentRows,
        projects: projectRows,
        costCenters: costCenterRows,
        locations: locationRows,
        paymentMethods: paymentMethodRows,
        currencyExchangeRates: currencyExchangeRateRows,
        vendors: vendorRows,
        customers: customerRows,
        inventoryItems: inventoryItemRows,
        inventoryTransactions: inventoryTransactionRows,
        stockAdjustments: stockAdjustmentRows,
        fixedAssets: fixedAssetRows,
        depreciationSchedules: depreciationScheduleRows,
        employees: employeeRows,
        birPolicies: birPolicyRows,
        atcDefinitions: atcDefinitionRows,
        budgets: budgetRows,
        recurringJournals: recurringJournalRows,
        cashFlowForecasts: cashFlowForecastRows,
        payrollRuns: payrollRunRows,
        payrollItems: payrollItemRows,
        purchaseRequisitions: purchaseRequisitionRows,
        purchaseOrders: purchaseOrderRows,
        purchaseOrderLines: purchaseOrderLineRows,
        goodsReceiptNotes: goodsReceiptNoteRows,
        goodsReceiptLines: goodsReceiptLineRows,
        salesInvoices: salesInvoiceRows,
        salesInvoiceLines: salesInvoiceLineRows,
        purchaseBills: purchaseBillRows,
        purchaseBillLines: purchaseBillLineRows,
        supplierPayments: supplierPaymentRows,
        supplierPaymentApplications: supplierPaymentAppRows,
        customerPayments: customerPaymentRows,
        customerPaymentApplications: customerPaymentAppRows,
        creditMemos: creditMemoRows,
        creditMemoLines: creditMemoLineRows,
        creditMemoApplications: creditMemoAppRows,
        debitMemos: debitMemoRows,
        debitMemoLines: debitMemoLineRows,
        debitMemoApplications: debitMemoAppRows,
        journalEntries: journalEntryRows,
        journalLines: journalLineRows,
        cashAdvances: cashAdvanceRows,
        cashTransactions: cashTransactionRows,
        cashTransactionLines: cashTransactionLineRows,
        checks: checkRows,
        bankDeposits: bankDepositRows,
        cashCounts: cashCountRows,
        cashCountDenominations: cashCountDenominationRows,
        bankReconciliations: bankReconciliationRows,
        bankStatementLines: bankStatementLineRows,
        bankReconciliationAdjustments: bankReconciliationAdjustmentRows,
        bankTransactions: bankTransactionRows,
        bankReconciliationApprovals: bankReconciliationApprovalRows,
        fxRevaluationRuns: fxRevaluationRunRows,
        taxFilings: taxFilingRows,
        taxFilingChecklists: taxFilingChecklistRows,
        taxManualAdjustments: taxManualAdjustmentRows,
        taxExceptions: taxExceptionRows,
        taxCalendar: taxCalendarRows,
        electronicFilingSubmissions: electronicFilingSubmissionRows,
        statutoryTrustAnchors: statutoryTrustAnchorRows,
        statutoryUpdatePackages: statutoryUpdatePackageRows,
        statutoryRules: statutoryRuleRows,
        statutoryAuditLogs: statutoryAuditLogRows,
        taxCalculations: taxCalculationRows,
        documents: documentRows,
        documentVersions: documentVersionRows,
        documentOcrHistory: documentOcrHistoryRows,
        companyDocuments: companyDocumentRows,
        auditLogs: auditLogRows,
        auditEngagements: auditEngagementRows,
        auditEngagementItems: auditEngagementItemRows,
        auditEngagementLogs: auditEngagementLogRows,
        auditPlanningDocs: auditPlanningDocRows,
        auditSignificantAccounts: auditSignificantAccountRows,
        auditRisksAndProcedures: auditRisksAndProcedureRows,
        auditPlanningVersions: auditPlanningVersionRows,
        auditWorkpapers: auditWorkpaperRows,
        auditWorkpaperVersions: auditWorkpaperVersionRows,
        auditFindings: auditFindingRows,
        auditAdjustments: auditAdjustmentRows,
        approvalWorkflowRequests: approvalWorkflowRequestRows,
        approvalWorkflows: approvalWorkflowRows,
        approvalSteps: approvalStepRows,
        approvalIdempotencyKeys: approvalIdempotencyKeyRows,
        approvalDelegations: approvalDelegationRows,
        internalControlsLog: internalControlsLogRows,
        fraudFlags: fraudFlagRows,
        notifications: notificationRows,
        aiExecutionLogs: aiExecutionLogRows,
        integrityScanReports: integrityScanReportRows,
        integrityScanFindings: integrityScanFindingRows,
        documentFiles: documentFiles as any,
      };

      const data = JSON.parse(JSON.stringify(rawData));

      const checksum = this.generateChecksum(data);
      const signature = this.generateSignature(data);
      const companyName = companyRows[0]?.legalName || "Company";

      let auditHmacEnvelope: any = undefined;
      try {
        auditHmacEnvelope = AuditHmacKeyManager.exportPortableKeyringEnvelopeSync(companyId, 'Company Owner') || undefined;
      } catch {}

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
          documentArchiveMode: useDirectorySnapshot ? 'REPOSITORY_DIRECTORY_SNAPSHOT' : 'INLINE_BASE64',
          sourceOriginalsDir,
          auditHmacEnvelope,
        },
        data,
      };
    });
  }
}

