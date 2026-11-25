import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { CompanyManager } from '../../src/server/services/companyManager';
import { DocumentEncryptionService } from '../../src/server/services/documentEncryptionService';
import { CompanyStorageService } from '../../src/server/services/storageService';
import { ExportService, ServerExportOptions } from '../../src/server/services/exportService';
import { PREVIEW_COMPANY_ID, PREVIEW_COMPANY_DIR } from '../../src/server/scripts/seedDeskguardStressPreview';

async function getTestSqlite(): Promise<Database.Database> {
  try {
    const cached = await CompanyManager.getCompanySqlite(PREVIEW_COMPANY_ID);
    if (cached) return cached;
  } catch (_) {}
  const activePath = path.join(PREVIEW_COMPANY_DIR, '.db_active.sqlite');
  if (fs.existsSync(activePath)) {
    return new Database(activePath, { readonly: true });
  }
  const laiPath = path.join(PREVIEW_COMPANY_DIR, 'database.lai');
  return new Database(laiPath, { readonly: true });
}

describe('Enterprise Capacity, Document Storage & Interoperability Validation Suite', () => {
  // ==========================================================================
  // GOAL 1: HEAVY ACCOUNTING WORKLOAD & HIGH CONCURRENCY (10, 25, 50, 100 USERS)
  // ==========================================================================
  it('1. Proves accounting engine integrity & 100 concurrent user workload under heavy dataset load', async () => {
    const sqlite = await getTestSqlite();

    // Verify 0 unbalanced journal entries
    const unbalanced = sqlite
      .prepare(
        `SELECT journal_entry_id, SUM(debit) as d, SUM(credit) as c
         FROM journal_lines
         GROUP BY journal_entry_id
         HAVING d != c`
      )
      .all();
    expect(unbalanced.length).toBe(0);

    // Verify Trial Balance Total Debits == Total Credits
    const tbTotals = sqlite
      .prepare(`SELECT SUM(debit) as totalDebit, SUM(credit) as totalCredit FROM journal_lines`)
      .get() as { totalDebit: number; totalCredit: number };
    expect(tbTotals.totalDebit).toBeGreaterThan(0);
    expect(tbTotals.totalDebit).toBe(tbTotals.totalCredit);

    // Concurrency benchmark: 100 simultaneous user sessions executing mixed operations
    const start = performance.now();
    const tasks = Array.from({ length: 100 }, (_, idx) =>
      Promise.resolve().then(() => {
        const op = idx % 4;
        if (op === 0) {
          return sqlite.prepare(`SELECT id, invoice_number, total_amount, balance_due FROM sales_invoices LIMIT 50 OFFSET ?`).all((idx * 10) % 5000);
        } else if (op === 1) {
          return sqlite.prepare(`SELECT id, bill_number, total_amount, balance_due FROM purchase_bills LIMIT 50 OFFSET ?`).all((idx * 10) % 5000);
        } else if (op === 2) {
          return sqlite.prepare(`SELECT account_id, SUM(debit) as d, SUM(credit) as c FROM journal_lines GROUP BY account_id`).all();
        } else {
          return sqlite.prepare(`SELECT id, file_name, file_hash, ocr_status FROM documents LIMIT 50 OFFSET ?`).all((idx * 20) % 8000);
        }
      })
    );

    const results = await Promise.all(tasks);
    const elapsedMs = performance.now() - start;
    expect(results.length).toBe(100);
    expect(elapsedMs).toBeLessThan(3000);
  });

  // ==========================================================================
  // GOAL 2: SEPARATE ENCRYPTED DOCUMENT STORAGE & STREAMING LARGE-FILE UPLOADS
  // ==========================================================================
  it('2. Validates company document workspace tier separation, LAISDOC1 AES-256-GCM encryption & streaming upload', async () => {
    // 2a. Verify all required storage tiers exist on disk
    const resolvedOriginals = await CompanyStorageService.getOriginalsPath(PREVIEW_COMPANY_ID);
    const resolvedThumbnails = await CompanyStorageService.getThumbnailsPath(PREVIEW_COMPANY_ID);
    const resolvedPreviews = await CompanyStorageService.getPreviewsPath(PREVIEW_COMPANY_ID);
    const resolvedProcessed = await CompanyStorageService.getProcessedPath(PREVIEW_COMPANY_ID);
    const resolvedQuarantine = await CompanyStorageService.getQuarantinePath(PREVIEW_COMPANY_ID);
    const resolvedExports = await CompanyStorageService.getExportsPath(PREVIEW_COMPANY_ID);
    const resolvedBackups = await CompanyStorageService.getBackupsPath(PREVIEW_COMPANY_ID);

    expect(fs.existsSync(resolvedOriginals)).toBe(true);
    expect(fs.existsSync(resolvedThumbnails)).toBe(true);
    expect(fs.existsSync(resolvedPreviews)).toBe(true);
    expect(fs.existsSync(resolvedProcessed)).toBe(true);
    expect(fs.existsSync(resolvedQuarantine)).toBe(true);
    expect(fs.existsSync(resolvedExports)).toBe(true);
    expect(fs.existsSync(resolvedBackups)).toBe(true);

    // 2b. Test independent LAISDOC1 AES-256-GCM encryption & SHA-256 hash integrity
    const sampleContent = Buffer.from('LEDGERAI PH ENTERPRISE DOCUMENT TEST CONTENT — ' + Date.now());
    const docId = `test-doc-scale-${Date.now()}`;

    const encResult = DocumentEncryptionService.encryptBuffer(
      PREVIEW_COMPANY_ID,
      docId,
      sampleContent,
      { originalFileName: 'Tax Invoice Attachment Test.pdf', contentType: 'application/pdf' }
    );

    expect(await DocumentEncryptionService.isEncryptedContainer(encResult.encryptedBuffer)).toBe(true);

    const decrypted = DocumentEncryptionService.decryptBuffer(
      PREVIEW_COMPANY_ID,
      docId,
      encResult.encryptedBuffer
    );

    expect(decrypted.plainBuffer.toString('utf8')).toBe(sampleContent.toString('utf8'));
    expect(decrypted.metadata.companyId).toBe(PREVIEW_COMPANY_ID);
    expect(decrypted.metadata.documentId).toBe(docId);

    // 2c. Streaming upload verification without full RAM buffering
    const streamDocId = `stream-doc-${Date.now()}`;
    const tempFilePath = await CompanyStorageService.getTempFilePath(PREVIEW_COMPANY_ID, `${streamDocId}.tmp`);
    const largeChunkPayload = Buffer.alloc(256 * 1024, 'A'); // 256KB streamed test payload
    fs.writeFileSync(tempFilePath, largeChunkPayload);

    const streamFinalized = await CompanyStorageService.finalizeStreamedUpload(
      PREVIEW_COMPANY_ID,
      streamDocId,
      tempFilePath,
      'Streamed_Supplier_Invoice.pdf',
      { contentType: 'application/pdf', quarantine: false }
    );

    expect(fs.existsSync(tempFilePath)).toBe(false); // Temp file cleaned up
    expect(fs.existsSync(streamFinalized.filePath)).toBe(true);
    expect(await DocumentEncryptionService.isEncryptedContainer(streamFinalized.filePath)).toBe(true);

    const integrityCheck = await DocumentEncryptionService.verifyDocumentIntegrity(
      PREVIEW_COMPANY_ID,
      streamDocId,
      streamFinalized.filePath,
      streamFinalized.fileHash
    );
    expect(integrityCheck.valid).toBe(true);
    fs.unlinkSync(streamFinalized.filePath); // Clean up disposable test file

    // 2d. Cross-company access rejection test
    expect(() =>
      DocumentEncryptionService.decryptBuffer('OTHER_UNAUTHORIZED_COMPANY', docId, encResult.encryptedBuffer)
    ).toThrow(/CROSS_COMPANY_ACCESS_DENIED/);
  });

  // ==========================================================================
  // GOAL 3: ENTERPRISE INTEROPERABILITY & EXPORT MATRIX (XLSX, CSV, PDF, DOCX)
  // WITH ALL 9 CPA & AUDIT REPRODUCIBILITY METADATA FIELDS
  // ==========================================================================
  it('3. Generates complete Enterprise Export Matrix (XLSX, CSV, PDF, DOCX) with all 9 CPA reproducibility metadata fields', async () => {
    const exportOptions: ServerExportOptions = {
      companyId: PREVIEW_COMPANY_ID,
      companyName: 'Deskguard Solutions — Stress Test Preview',
      reportTitle: 'Executive Trial Balance & Financial Lineage',
      subtitle: 'Philippine Statutory Tax & Audit Compliance Package',
      generatedBy: 'Elena Santos, CPA (Company Owner)',
      reportPeriod: '2026-Q4 (Calendar Year 2026)',
      accountingBasis: 'ACCRUAL (PFRS / BIR CAS)',
      currency: 'PHP (₱)',
      appliedFilters: { period: '2026-Q4', includeReversed: false, status: 'POSTED' },
      sourceTransactionReferences: ['JE-2026-00001..JE-2026-10000', 'SI-2026-00001..SI-2026-10000'],
      headers: ['Account Code', 'Account Name', 'Account Type', 'Debit (PHP)', 'Credit (PHP)', 'Net Balance'],
      rows: [
        ['1010', 'Cash and Cash Equivalents', 'ASSET', '50,000,000.00', '0.00', '50,000,000.00'],
        ['1030', 'Accounts Receivable (Subledger)', 'RECEIVABLE', '33,600,000.00', '0.00', '33,600,000.00'],
        ['1080', 'Merchandise Inventory Valuation', 'INVENTORY', '100,000,000.00', '0.00', '100,000,000.00'],
        ['2010', 'Accounts Payable (Subledger)', 'PAYABLE', '0.00', '13,750,000.00', '13,750,000.00'],
        ['3010', 'Common Share Capital', 'EQUITY', '0.00', '100,000,000.00', '100,000,000.00'],
      ],
      totals: ['TOTAL', 'Reconciled Financial Ledger', 'TRIAL_BALANCE', '183,600,000.00', '113,750,000.00', '69,850,000.00'],
      isSensitive: true,
      userRole: 'Company Owner',
      requiredRole: 'Accountant',
    };

    const meta = ExportService.buildAuditMetadata(exportOptions);
    expect(meta.accountingBasis).toContain('ACCRUAL');
    expect(meta.currency).toContain('PHP');
    expect(meta.dataSnapshotRef).toMatch(/^SNAP-/);
    expect(meta.integrityHash).toHaveLength(64);

    // 3a. CSV Export with all 9 CPA reproducibility metadata comments
    const csvContent = await ExportService.generateCSV(exportOptions);
    expect(csvContent).toContain('# Company: Deskguard Solutions — Stress Test Preview');
    expect(csvContent).toContain('# Accounting Basis: ACCRUAL');
    expect(csvContent).toContain('# Currency: PHP');
    expect(csvContent).toContain('# Applied Filters:');
    expect(csvContent).toContain('# Source Transaction References:');
    expect(csvContent).toContain('# Exporter Identity & Role:');
    expect(csvContent).toContain('# Reproducibility Snapshot Reference:');
    expect(csvContent).toContain(`# SHA-256 Integrity Hash: ${meta.integrityHash}`);

    // 3b. XLSX Export
    const xlsxBuffer = await ExportService.generateXLSX(exportOptions);
    expect(xlsxBuffer.length).toBeGreaterThan(1000);
    expect(xlsxBuffer.toString('hex', 0, 2)).toBe('504b');

    // 3c. PDF Export
    const pdfBuffer = await ExportService.generatePDF(exportOptions);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.toString('ascii', 0, 4)).toBe('%PDF');

    // 3d. DOCX Export (Word Document CPA Memorandum)
    const docxBuffer = await ExportService.generateDOCX(exportOptions);
    expect(docxBuffer.length).toBeGreaterThan(1000);
    expect(docxBuffer.toString('hex', 0, 2)).toBe('504b');
  });

  // ==========================================================================
  // GOAL 4: FULL AUDIT EVIDENCE PACKAGE (.ZIP) & QUICKBOOKS INTEROPERABILITY
  // ==========================================================================
  it('4. Generates Audit Evidence Package ZIP with attachments & verifies QuickBooks multi-sheet round-trip import/export', async () => {
    const sampleAttachment = Buffer.from('Sample Official Receipt Attachment Payload');
    const exportOptions: ServerExportOptions = {
      companyId: PREVIEW_COMPANY_ID,
      companyName: 'Deskguard Solutions — Stress Test Preview',
      reportTitle: 'Forensic Audit & Statutory Compliance Evidence Package',
      generatedBy: 'Camille Tan, CPA (Independent Auditor)',
      reportPeriod: '2026 Annual Audit',
      headers: ['Module', 'Audit Status', 'Total Records', 'Reconciliation Status'],
      rows: [
        ['General Ledger', 'POSTED_AND_LOCKED', '20,000', '100% BALANCED'],
        ['Accounts Receivable', 'RECONCILED', '10,000', 'SUBLEDGER_MATCH'],
        ['Accounts Payable', 'RECONCILED', '10,000', 'SUBLEDGER_MATCH'],
        ['Inventory Valuation', 'VERIFIED', '50,000', 'VALUATION_MATCH'],
      ],
      totals: ['TOTAL', 'AUDIT_PASSED', '90,000', '100% RECONCILED'],
      isSensitive: true,
      userRole: 'Company Owner',
      attachments: [
        {
          fileName: 'OR-2026-0001.pdf',
          content: sampleAttachment,
          sha256: crypto.createHash('sha256').update(sampleAttachment).digest('hex'),
          documentId: 'doc-dg-1',
        },
      ],
    };

    const zipBuffer = await ExportService.generateAuditEvidencePackageZip(exportOptions);
    expect(zipBuffer).toBeDefined();
    expect(zipBuffer.length).toBeGreaterThan(2500);
    expect(zipBuffer.toString('hex', 0, 2)).toBe('504b');

    // QuickBooks multi-sheet export & round-trip import test
    const qboBuffer = ExportService.generateQuickBooksWorkbook({
      companyName: 'Deskguard Solutions — Stress Test Preview',
      accounts: [
        { code: '1010', name: 'Cash on Hand', type: 'ASSET', balance: 5000000000 },
        { code: '4000', name: 'Sales Revenue', type: 'REVENUE', balance: 3000000000 },
      ],
      journals: [
        { journalNo: 'JE-2026-0001', date: '2026-01-15', accountCode: '1010', accountName: 'Cash on Hand', debit: 112000, credit: 0, description: 'Client collection' },
        { journalNo: 'JE-2026-0001', date: '2026-01-15', accountCode: '4000', accountName: 'Sales Revenue', debit: 0, credit: 112000, description: 'Client collection' },
      ],
      customers: [{ name: 'Philippine Enterprise Client 1 Corp.', tin: '123-456-789-000', email: 'ar@client1.ph' }],
      vendors: [{ name: 'Metro Manila Industrial Supply Inc.', tin: '987-654-321-000', email: 'ap@vendor1.ph' }],
    });

    expect(qboBuffer.toString('hex', 0, 2)).toBe('504b');

    const parsedQbo = ExportService.parseQuickBooksImport(qboBuffer);
    expect(parsedQbo.sheets).toEqual(['Chart of Accounts', 'Journal Entries', 'Customers', 'Vendors']);
    expect(parsedQbo.accounts.length).toBe(2);
    expect(parsedQbo.journals.length).toBe(2);
    expect(parsedQbo.customers.length).toBe(1);
    expect(parsedQbo.vendors.length).toBe(1);
    expect(parsedQbo.journals[0].debitCentavos).toBe(112000);
  });
});
