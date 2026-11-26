import { Router } from "express";
import { db } from "../db";
import { dbContext } from "../db/context";
import { CompanyManager } from "../services/companyManager";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, and, desc, sql, or, like, gte, lte, inArray } from "drizzle-orm";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import crypto from "crypto";
import fs from 'fs/promises';
import path from 'path';
import { broadcastNotification } from "../ws";
import { AuditService } from "../services/auditService";
import { CompanyStorageService } from "../services/storageService";
import { OCRService, ExtractedDocumentData } from "../services/ocrService";
import { DocumentEncryptionService } from "../services/documentEncryptionService";
import Busboy from 'busboy';
import fsSync from 'fs';
import { AccountingEngine } from "../services/accountingEngine";
import { createPurchaseBill, createSalesInvoice } from "../db/business_transactions";

const router = Router();

async function ensureDocumentsSchema() {
  const alterStatements = [
    "ALTER TABLE documents ADD COLUMN document_type text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL",
    "ALTER TABLE documents ADD COLUMN original_file_name text",
    "ALTER TABLE documents ADD COLUMN file_size integer DEFAULT 0 NOT NULL",
    "ALTER TABLE documents ADD COLUMN file_hash text",
    "ALTER TABLE documents ADD COLUMN file_path text",
    "ALTER TABLE documents ADD COLUMN encryption_status text DEFAULT 'ENCRYPTED_AES256_GCM'",
    "ALTER TABLE documents ADD COLUMN storage_tier text DEFAULT 'ORIGINALS'",
    "ALTER TABLE documents ADD COLUMN quarantine_reason text",
    "ALTER TABLE documents ADD COLUMN source text DEFAULT 'WEB_UI' NOT NULL",
    "ALTER TABLE documents ADD COLUMN linked_transaction_type text",
    "ALTER TABLE documents ADD COLUMN linked_transaction_id text",
    "ALTER TABLE documents ADD COLUMN linked_vendor_id text",
    "ALTER TABLE documents ADD COLUMN linked_customer_id text",
    "ALTER TABLE documents ADD COLUMN ocr_status text DEFAULT 'PENDING'",
    "ALTER TABLE documents ADD COLUMN verification_status text DEFAULT 'UNVERIFIED' NOT NULL",
    "ALTER TABLE documents ADD COLUMN confidence_score real",
    "ALTER TABLE documents ADD COLUMN ocr_result text",
    "ALTER TABLE documents ADD COLUMN extracted_merchant text",
    "ALTER TABLE documents ADD COLUMN extracted_customer text",
    "ALTER TABLE documents ADD COLUMN extracted_tin text",
    "ALTER TABLE documents ADD COLUMN extracted_address text",
    "ALTER TABLE documents ADD COLUMN extracted_invoice_number text",
    "ALTER TABLE documents ADD COLUMN extracted_date text",
    "ALTER TABLE documents ADD COLUMN extracted_total_amount integer",
    "ALTER TABLE documents ADD COLUMN extracted_vat_amount integer",
    "ALTER TABLE documents ADD COLUMN extracted_vatable_sales integer",
    "ALTER TABLE documents ADD COLUMN extracted_vat_exempt_sales integer",
    "ALTER TABLE documents ADD COLUMN extracted_zero_rated_sales integer",
    "ALTER TABLE documents ADD COLUMN extracted_withholding_tax integer",
    "ALTER TABLE documents ADD COLUMN extracted_payment_method text",
    "ALTER TABLE documents ADD COLUMN extracted_category text",
    "ALTER TABLE documents ADD COLUMN validation_errors text",
    "ALTER TABLE documents ADD COLUMN validation_warnings text",
    "ALTER TABLE documents ADD COLUMN notes text",
    "ALTER TABLE documents ADD COLUMN extraction_engine text",
    "ALTER TABLE documents ADD COLUMN page_count integer DEFAULT 1",
    "ALTER TABLE documents ADD COLUMN verified_by text",
    "ALTER TABLE documents ADD COLUMN verified_at integer",
    "ALTER TABLE documents ADD COLUMN updated_at integer"
  ];
  for (const stmt of alterStatements) {
    try {
      await db.run(sql.raw(stmt));
    } catch (_) {}
  }
}

// =========================================================================
// 1. GET ALL DOCUMENTS (WITH ADVANCED SEARCH & MULTI-CRITERIA FILTERS)
// =========================================================================
router.get("/", requireAuth, requirePermission('documents:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req, 50, 200);

  const {
    q,
    documentType,
    verificationStatus,
    ocrStatus,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    hasLinkedTransaction,
    vendorId,
    customerId,
    status = 'ACTIVE'
  } = req.query;

  const conditions: any[] = [
    eq(schema.documents.companyId, companyId),
    eq(schema.documents.status, (status as string) || 'ACTIVE')
  ];

  try {

    if (documentType && documentType !== 'ALL') {
      conditions.push(eq(schema.documents.documentType, documentType as string));
    }

    if (verificationStatus && verificationStatus !== 'ALL') {
      conditions.push(eq(schema.documents.verificationStatus, verificationStatus as string));
    }

    if (ocrStatus && ocrStatus !== 'ALL') {
      conditions.push(eq(schema.documents.ocrStatus, ocrStatus as string));
    }

    const start = (startDate as string) || params.fromDate;
    if (start) {
      conditions.push(gte(schema.documents.extractedDate, start));
    }

    const end = (endDate as string) || params.toDate;
    if (end) {
      conditions.push(lte(schema.documents.extractedDate, end));
    }

    if (minAmount) {
      const minCentavos = Math.round(parseFloat(minAmount as string) * 100);
      if (!isNaN(minCentavos)) {
        conditions.push(gte(schema.documents.extractedTotalAmount, minCentavos));
      }
    }

    if (maxAmount) {
      const maxCentavos = Math.round(parseFloat(maxAmount as string) * 100);
      if (!isNaN(maxCentavos)) {
        conditions.push(lte(schema.documents.extractedTotalAmount, maxCentavos));
      }
    }

    if (hasLinkedTransaction === 'true') {
      conditions.push(sql`${schema.documents.linkedTransactionId} IS NOT NULL AND ${schema.documents.linkedTransactionId} != 'NONE'`);
    } else if (hasLinkedTransaction === 'false') {
      conditions.push(sql`(${schema.documents.linkedTransactionId} IS NULL OR ${schema.documents.linkedTransactionId} = 'NONE')`);
    }

    if (vendorId) {
      conditions.push(eq(schema.documents.linkedVendorId, vendorId as string));
    }

    if (customerId) {
      conditions.push(eq(schema.documents.linkedCustomerId, customerId as string));
    }

    const searchStr = (q as string) || params.search;
    if (searchStr && searchStr.trim().length > 0) {
      const searchPattern = `%${searchStr.trim()}%`;
      conditions.push(or(
        like(schema.documents.fileName, searchPattern),
        like(schema.documents.extractedMerchant, searchPattern),
        like(schema.documents.extractedCustomer, searchPattern),
        like(schema.documents.extractedInvoiceNumber, searchPattern),
        like(schema.documents.extractedTin, searchPattern),
        like(schema.documents.notes, searchPattern)
      ));
    }

    const cursorCond = buildCursorCondition(
      schema.documents.createdAt,
      schema.documents.id,
      params.decodedCursor,
      'DESC'
    );

    const queryConditions = [...conditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.documents)
      .where(and(...conditions));
    const totalCount = Number(countRes?.total || 0);

    const docs = await db.select({
      id: schema.documents.id,
      companyId: schema.documents.companyId,
      entityType: schema.documents.entityType,
      entityId: schema.documents.entityId,
      documentType: schema.documents.documentType,
      fileName: schema.documents.fileName,
      originalFileName: schema.documents.originalFileName,
      fileType: schema.documents.fileType,
      fileSize: schema.documents.fileSize,
      fileHash: schema.documents.fileHash,
      filePath: schema.documents.filePath,
      source: schema.documents.source,
      linkedTransactionType: schema.documents.linkedTransactionType,
      linkedTransactionId: schema.documents.linkedTransactionId,
      linkedVendorId: schema.documents.linkedVendorId,
      linkedCustomerId: schema.documents.linkedCustomerId,
      status: schema.documents.status,
      ocrStatus: schema.documents.ocrStatus,
      verificationStatus: schema.documents.verificationStatus,
      confidenceScore: schema.documents.confidenceScore,
      extractedMerchant: schema.documents.extractedMerchant,
      extractedCustomer: schema.documents.extractedCustomer,
      extractedTin: schema.documents.extractedTin,
      extractedAddress: schema.documents.extractedAddress,
      extractedInvoiceNumber: schema.documents.extractedInvoiceNumber,
      extractedDate: schema.documents.extractedDate,
      extractedTotalAmount: schema.documents.extractedTotalAmount,
      extractedVatAmount: schema.documents.extractedVatAmount,
      extractedVatableSales: schema.documents.extractedVatableSales,
      extractedVatExemptSales: schema.documents.extractedVatExemptSales,
      extractedZeroRatedSales: schema.documents.extractedZeroRatedSales,
      extractedWithholdingTax: schema.documents.extractedWithholdingTax,
      extractedPaymentMethod: schema.documents.extractedPaymentMethod,
      extractedCategory: schema.documents.extractedCategory,
      validationErrors: schema.documents.validationErrors,
      validationWarnings: schema.documents.validationWarnings,
      notes: schema.documents.notes,
      verifiedBy: schema.documents.verifiedBy,
      verifiedAt: schema.documents.verifiedAt,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
      uploadedBy: schema.documents.uploadedBy,
      uploaderName: schema.users.displayName,
      uploaderEmail: schema.users.email,
    })
      .from(schema.documents)
      .leftJoin(schema.users, eq(schema.documents.uploadedBy, schema.users.id))
      .where(and(...queryConditions))
      .orderBy(desc(schema.documents.createdAt), desc(schema.documents.id))
      .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: docs,
      limit: params.limit,
      getSortValAndId: (d: any) => ({
        val: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
        id: d.id
      }),
      totalCount,
      raw: params.raw
    }));
  } catch (error: any) {
    if (error?.message?.includes("no such column") || error?.cause?.message?.includes("no such column")) {
      console.warn("[Documents API] Detected missing column, running schema patch...");
      await ensureDocumentsSchema();
      try {
        const retryDocs = await db.select({
          id: schema.documents.id,
          companyId: schema.documents.companyId,
          entityType: schema.documents.entityType,
          entityId: schema.documents.entityId,
          documentType: schema.documents.documentType,
          fileName: schema.documents.fileName,
          originalFileName: schema.documents.originalFileName,
          fileType: schema.documents.fileType,
          fileSize: schema.documents.fileSize,
          fileHash: schema.documents.fileHash,
          filePath: schema.documents.filePath,
          source: schema.documents.source,
          linkedTransactionType: schema.documents.linkedTransactionType,
          linkedTransactionId: schema.documents.linkedTransactionId,
          linkedVendorId: schema.documents.linkedVendorId,
          linkedCustomerId: schema.documents.linkedCustomerId,
          status: schema.documents.status,
          ocrStatus: schema.documents.ocrStatus,
          verificationStatus: schema.documents.verificationStatus,
          confidenceScore: schema.documents.confidenceScore,
          extractedMerchant: schema.documents.extractedMerchant,
          extractedCustomer: schema.documents.extractedCustomer,
          extractedTin: schema.documents.extractedTin,
          extractedAddress: schema.documents.extractedAddress,
          extractedInvoiceNumber: schema.documents.extractedInvoiceNumber,
          extractedDate: schema.documents.extractedDate,
          extractedTotalAmount: schema.documents.extractedTotalAmount,
          extractedVatAmount: schema.documents.extractedVatAmount,
          extractedVatableSales: schema.documents.extractedVatableSales,
          extractedVatExemptSales: schema.documents.extractedVatExemptSales,
          extractedZeroRatedSales: schema.documents.extractedZeroRatedSales,
          extractedWithholdingTax: schema.documents.extractedWithholdingTax,
          extractedPaymentMethod: schema.documents.extractedPaymentMethod,
          extractedCategory: schema.documents.extractedCategory,
          validationErrors: schema.documents.validationErrors,
          validationWarnings: schema.documents.validationWarnings,
          notes: schema.documents.notes,
          verifiedBy: schema.documents.verifiedBy,
          verifiedAt: schema.documents.verifiedAt,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          uploadedBy: schema.documents.uploadedBy,
          uploaderName: schema.users.displayName,
          uploaderEmail: schema.users.email,
        })
          .from(schema.documents)
          .leftJoin(schema.users, eq(schema.documents.uploadedBy, schema.users.id))
          .where(and(...conditions))
          .orderBy(desc(schema.documents.createdAt));

        return res.json(retryDocs);
      } catch (retryError) {
        console.error("[Documents API] Retry after schema patch failed:", retryError);
      }
    }
    console.error("[Documents API] Failed to fetch documents:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: error.message });
  }
});

// =========================================================================
// 1B. BULK DOCUMENT ATTACHMENT EXPORT (.ZIP WITH ORIGINALS & SHA-256 MANIFEST)
// =========================================================================
const handleBulkAttachmentZipExport = async (req: any, res: any) => {
  const companyId = req.activeCompany!.id;
  const companyRow = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const companyName = companyRow?.legalName || (req.activeCompany as any)?.legalName || "Active Company";
  const exporterIdentity = req.user?.displayName || req.user?.email || "Authorized User";
  const exporterRole = (req.activeCompany as any)?.role || "Accountant";
  const docIds: string[] = Array.isArray(req.body?.documentIds)
    ? req.body.documentIds
    : typeof req.query.ids === 'string' && req.query.ids.trim()
      ? req.query.ids.split(',').map((s: string) => s.trim())
      : [];
  const maxLimit = Math.min(200, Math.max(1, Number(req.query.limit || req.body?.limit || 50)));

  try {
    const docs = docIds.length > 0
      ? await db.select().from(schema.documents).where(and(eq(schema.documents.companyId, companyId), inArray(schema.documents.id, docIds)))
      : await db.select().from(schema.documents).where(and(eq(schema.documents.companyId, companyId), eq(schema.documents.status, 'ACTIVE'))).orderBy(desc(schema.documents.createdAt)).limit(maxLimit);

    const manifestEntries: any[] = [];
    const decryptedFiles: Array<{ zipName: string; buffer: Buffer }> = [];

    for (const doc of docs) {
      let status = 'VERIFIED_AND_DECRYPTED';
      let plainBuf: Buffer | null = null;
      let computedSha256 = doc.fileHash || '';

      try {
        const rawBuf = await fs.readFile(doc.filePath);
        if (await DocumentEncryptionService.isEncryptedContainer(rawBuf)) {
          const dec = DocumentEncryptionService.decryptBuffer(companyId, doc.id, rawBuf);
          plainBuf = dec.plainBuffer;
          computedSha256 = crypto.createHash('sha256').update(plainBuf).digest('hex');
        } else {
          plainBuf = rawBuf;
          computedSha256 = crypto.createHash('sha256').update(plainBuf).digest('hex');
        }
      } catch (fileErr: any) {
        status = `MISSING_OR_CORRUPTED: ${fileErr.message}`;
      }

      const safeFileName = `${doc.id}_${path.basename(doc.originalFileName || doc.fileName || 'attachment.bin').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      if (plainBuf) {
        decryptedFiles.push({ zipName: `originals/${safeFileName}`, buffer: plainBuf });
      }

      manifestEntries.push({
        documentId: doc.id,
        fileName: doc.originalFileName || doc.fileName,
        archivePath: plainBuf ? `originals/${safeFileName}` : null,
        mimeType: doc.fileType,
        sizeBytes: doc.fileSize,
        sha256Hash: computedSha256,
        encryptionAtRest: doc.encryptionStatus || 'ENCRYPTED_AES256_GCM',
        storageTier: doc.storageTier || 'ORIGINALS',
        verificationStatus: doc.verificationStatus,
        linkedTransactionType: doc.linkedTransactionType || null,
        linkedTransactionId: doc.linkedTransactionId || null,
        integrityStatus: status,
      });
    }

    const manifest = {
      packageType: 'LedgerAI PH — Bulk Document Attachments & Cryptographic Manifest',
      companyId,
      companyName,
      exportedAt: new Date().toISOString(),
      exporterIdentity,
      exporterRole,
      totalDocuments: manifestEntries.length,
      decryptedIncludedCount: decryptedFiles.length,
      missingOrCorruptedCount: manifestEntries.length - decryptedFiles.length,
      documents: manifestEntries,
    };

    const zipBuffer = await new Promise<Buffer>(async (resolve, reject) => {
      const archiverMod: any = await import('archiver');
      const archive = archiverMod.ZipArchive
        ? new archiverMod.ZipArchive({ zlib: { level: 9 } })
        : typeof archiverMod === 'function'
          ? archiverMod('zip', { zlib: { level: 9 } })
          : (archiverMod.default || archiverMod)('zip', { zlib: { level: 9 } });

      const chunks: Buffer[] = [];
      archive.on('data', (d: Buffer) => chunks.push(d));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(err));

      archive.append(JSON.stringify(manifest, null, 2), { name: 'Attachment_Manifest.json' });
      for (const f of decryptedFiles) {
        archive.append(f.buffer, { name: f.zipName });
      }
      archive.finalize();
    });

    await AuditService.log({
      req,
      companyId,
      action: 'EXPORT_DOCUMENT_ATTACHMENTS_ZIP',
      entityType: 'DOCUMENT',
      entityId: 'BULK_ZIP',
      entityName: `Bulk Attachment ZIP (${decryptedFiles.length} files)`,
      module: 'DOCUMENTS',
      metadata: { totalDocuments: manifestEntries.length, decryptedIncludedCount: decryptedFiles.length }
    });

    const cleanName = companyName.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Document_Attachments_${cleanName}.zip"`);
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).json({ error: "BULK_ZIP_EXPORT_FAILED", message: err.message });
  }
};

router.get("/export-zip", requireAuth, requirePermission('documents:view'), handleBulkAttachmentZipExport);
router.post("/export-zip", requireAuth, requirePermission('documents:view'), handleBulkAttachmentZipExport);

// =========================================================================
// 2. GET SINGLE DOCUMENT WITH LIVE VALIDATION & LINKED TRANSACTION DETAILS
// =========================================================================
router.get("/:id", requireAuth, requirePermission('documents:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const doc = await db.select({
      id: schema.documents.id,
      companyId: schema.documents.companyId,
      entityType: schema.documents.entityType,
      entityId: schema.documents.entityId,
      documentType: schema.documents.documentType,
      fileName: schema.documents.fileName,
      originalFileName: schema.documents.originalFileName,
      fileType: schema.documents.fileType,
      fileSize: schema.documents.fileSize,
      fileHash: schema.documents.fileHash,
      filePath: schema.documents.filePath,
      source: schema.documents.source,
      linkedTransactionType: schema.documents.linkedTransactionType,
      linkedTransactionId: schema.documents.linkedTransactionId,
      linkedVendorId: schema.documents.linkedVendorId,
      linkedCustomerId: schema.documents.linkedCustomerId,
      status: schema.documents.status,
      ocrStatus: schema.documents.ocrStatus,
      verificationStatus: schema.documents.verificationStatus,
      confidenceScore: schema.documents.confidenceScore,
      ocrResult: schema.documents.ocrResult,
      extractedMerchant: schema.documents.extractedMerchant,
      extractedCustomer: schema.documents.extractedCustomer,
      extractedTin: schema.documents.extractedTin,
      extractedAddress: schema.documents.extractedAddress,
      extractedInvoiceNumber: schema.documents.extractedInvoiceNumber,
      extractedDate: schema.documents.extractedDate,
      extractedTotalAmount: schema.documents.extractedTotalAmount,
      extractedVatAmount: schema.documents.extractedVatAmount,
      extractedVatableSales: schema.documents.extractedVatableSales,
      extractedVatExemptSales: schema.documents.extractedVatExemptSales,
      extractedZeroRatedSales: schema.documents.extractedZeroRatedSales,
      extractedWithholdingTax: schema.documents.extractedWithholdingTax,
      extractedPaymentMethod: schema.documents.extractedPaymentMethod,
      extractedCategory: schema.documents.extractedCategory,
      validationErrors: schema.documents.validationErrors,
      validationWarnings: schema.documents.validationWarnings,
      notes: schema.documents.notes,
      verifiedBy: schema.documents.verifiedBy,
      verifiedAt: schema.documents.verifiedAt,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
      uploadedBy: schema.documents.uploadedBy,
      uploaderName: schema.users.displayName,
      uploaderEmail: schema.users.email,
    })
      .from(schema.documents)
      .leftJoin(schema.users, eq(schema.documents.uploadedBy, schema.users.id))
      .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
      .get();

    if (!doc) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
      return;
    }

    // Parse OCR result if present
    let parsedOcr: ExtractedDocumentData | null = null;
    if (doc.ocrResult) {
      try {
        parsedOcr = JSON.parse(doc.ocrResult);
      } catch (_) {}
    }

    // Run real-time validation if we have extracted data
    let validationSummary: any = null;
    if (parsedOcr) {
      validationSummary = await OCRService.validateExtractedData(companyId, parsedOcr, doc.fileHash || undefined, doc.id);
    }

    // Get linked transaction info if linked
    let linkedTransaction: any = null;
    if (doc.linkedTransactionId && doc.linkedTransactionId !== 'NONE') {
      if (doc.linkedTransactionType === 'PURCHASE_BILL') {
        linkedTransaction = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, doc.linkedTransactionId)).get();
      } else if (doc.linkedTransactionType === 'SALES_INVOICE') {
        linkedTransaction = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, doc.linkedTransactionId)).get();
      } else if (doc.linkedTransactionType === 'JOURNAL_ENTRY') {
        linkedTransaction = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, doc.linkedTransactionId)).get();
      }
    }

    res.json({
      document: doc,
      parsedOcr,
      validationSummary,
      linkedTransaction
    });
  } catch (error: any) {
    console.error("[Documents API] Error fetching document:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: error.message });
  }
});

// =========================================================================
// 3. GET / STREAM DOCUMENT FILE PREVIEW / CONTENT
// =========================================================================
router.get("/:id/file", requireAuth, requirePermission('documents:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const doc = await db.select().from(schema.documents)
      .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
      .get();

    if (!doc) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document record not found" });
      return;
    }

    let targetPath = doc.filePath;
    try {
      await fs.access(targetPath);
    } catch {
      try {
        targetPath = await CompanyStorageService.resolveDocumentPath(companyId, path.basename(doc.filePath));
      } catch {
        res.status(404).json({ error: "FILE_MISSING", message: "Physical document file is not found on disk" });
        return;
      }
    }

    const fileBuffer = await fs.readFile(targetPath);
    let outputBuffer: Buffer;

    if (await DocumentEncryptionService.isEncryptedContainer(fileBuffer)) {
      try {
        const { buffer } = await DocumentEncryptionService.decryptFile(
          companyId,
          doc.id,
          targetPath
        );
        outputBuffer = buffer;
      } catch (decryptErr: any) {
        if (decryptErr.message?.includes('CROSS_COMPANY_ACCESS_DENIED')) {
          res.status(403).json({ error: "CROSS_COMPANY_ACCESS_DENIED", message: "Security violation: Access denied across company isolation boundaries." });
          return;
        }
        if (decryptErr.message?.includes('AUTH_TAG_VERIFICATION_FAILED') || decryptErr.message?.includes('DOCUMENT_ID_TAMPER_DETECTED')) {
          res.status(400).json({ error: "TAMPER_DETECTED", message: "Document ciphertext integrity check failed. Authentication tag mismatch or corrupted file." });
          return;
        }
        throw decryptErr;
      }
    } else {
      outputBuffer = fileBuffer;
    }

    let mimeType = doc.fileType || 'application/octet-stream';
    if (doc.fileName.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (doc.fileName.endsWith('.jpg') || doc.fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (doc.fileName.endsWith('.png')) mimeType = 'image/png';
    else if (doc.fileName.endsWith('.webp')) mimeType = 'image/webp';

    const safeName = path.basename(doc.originalFileName || doc.fileName);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'private, no-transform');
    res.send(outputBuffer);
  } catch (error: any) {
    console.error("[Documents API] File streaming error:", error);
    res.status(500).json({ error: "FILE_STREAM_ERROR", message: error.message });
  }
});

router.get("/:id/download", requireAuth, requirePermission('documents:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  try {
    const doc = await db.select().from(schema.documents)
      .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
      .get();

    if (!doc) {
      res.status(404).json({ error: "NOT_FOUND", message: "Document record not found" });
      return;
    }

    let targetPath = doc.filePath;
    try {
      await fs.access(targetPath);
    } catch {
      try {
        targetPath = await CompanyStorageService.resolveDocumentPath(companyId, path.basename(doc.filePath));
      } catch {
        res.status(404).json({ error: "FILE_MISSING", message: "Physical document file is not found on disk" });
        return;
      }
    }

    const fileBuffer = await fs.readFile(targetPath);
    let outputBuffer: Buffer;

    if (await DocumentEncryptionService.isEncryptedContainer(fileBuffer)) {
      try {
        const { buffer } = await DocumentEncryptionService.decryptFile(
          companyId,
          doc.id,
          targetPath
        );
        outputBuffer = buffer;
      } catch (decryptErr: any) {
        if (decryptErr.message?.includes('CROSS_COMPANY_ACCESS_DENIED')) {
          res.status(403).json({ error: "CROSS_COMPANY_ACCESS_DENIED", message: "Security violation: Access denied across company isolation boundaries." });
          return;
        }
        if (decryptErr.message?.includes('AUTH_TAG_VERIFICATION_FAILED') || decryptErr.message?.includes('DOCUMENT_ID_TAMPER_DETECTED')) {
          res.status(400).json({ error: "TAMPER_DETECTED", message: "Document ciphertext integrity check failed. Authentication tag mismatch or corrupted file." });
          return;
        }
        throw decryptErr;
      }
    } else {
      outputBuffer = fileBuffer;
    }

    let mimeType = doc.fileType || 'application/octet-stream';
    if (doc.fileName.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (doc.fileName.endsWith('.jpg') || doc.fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (doc.fileName.endsWith('.png')) mimeType = 'image/png';
    else if (doc.fileName.endsWith('.webp')) mimeType = 'image/webp';

    const safeName = path.basename(doc.originalFileName || doc.fileName);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`);
    res.setHeader('Content-Length', outputBuffer.length);
    res.setHeader('Cache-Control', 'private, no-transform');
    res.send(outputBuffer);
  } catch (error: any) {
    console.error("[Documents API] File download error:", error);
    res.status(500).json({ error: "FILE_DOWNLOAD_ERROR", message: error.message });
  }
});

// =========================================================================
// 4. UPLOAD / REGISTER A NEW DOCUMENT (WITH HASHING & AUTO-OCR OPTION)
// =========================================================================
router.post("/", requireAuth, requirePermission('documents:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const {
    fileName,
    fileType,
    documentType = 'RECEIPT',
    entityType = 'GENERAL',
    entityId = 'NONE',
    fileSize,
    fileContentBase64,
    source = 'WEB_UI',
    autoOcr = true,
    notes
  } = req.body;

  if (!fileName || !fileContentBase64 || typeof fileContentBase64 !== 'string') {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "fileName and non-empty fileContentBase64 are required." });
    return;
  }

  try {
    const cleanedBase64 = fileContentBase64.replace(/^data:.*?;base64,/, '').trim();
    const rawBuffer = cleanedBase64 ? Buffer.from(cleanedBase64, 'base64') : Buffer.alloc(0);
    if (rawBuffer.length === 0) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Document content cannot be empty." });
      return;
    }

    const calculatedSize = rawBuffer.length;
    const fileHash = OCRService.calculateFileHash(rawBuffer);

    // Check for duplicate SHA-256 hash in active company documents
    let isDuplicate = false;
    let duplicateDocId: string | undefined = undefined;
    if (fileHash) {
      const existingHash = await db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.companyId, companyId),
          eq(schema.documents.fileHash, fileHash),
          eq(schema.documents.status, 'ACTIVE')
        ))
        .get();

      if (existingHash) {
        isDuplicate = true;
        duplicateDocId = existingHash.id;
      }
    }

    const docId = crypto.randomUUID();
    const { filePath } = await CompanyStorageService.writeEncryptedDocument(
      companyId,
      fileName,
      rawBuffer,
      {
        documentId: docId,
        contentType: fileType || (fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      }
    );

    const newDoc = {
      id: docId,
      companyId,
      entityType,
      entityId,
      documentType: documentType || 'GENERAL_ATTACHMENT',
      fileName,
      originalFileName: fileName,
      fileType: fileType || (fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
      fileSize: calculatedSize,
      fileHash: fileHash || null,
      filePath,
      encryptionStatus: 'ENCRYPTED_AES256_GCM',
      storageTier: 'ORIGINALS',
      source: source || 'WEB_UI',
      uploadedBy: req.user!.id,
      status: "ACTIVE",
      ocrStatus: "PENDING",
      verificationStatus: "UNVERIFIED",
      notes: notes || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await db.insert(schema.documents).values(newDoc);
    } catch (insertErr) {
      await CompanyStorageService.cleanupFailedUpload(filePath);
      throw insertErr;
    }

    // If autoOcr is requested and we have content
    let extractedData: ExtractedDocumentData | null = null;
    let validationResult: any = null;

    if (autoOcr && rawBuffer.length > 0) {
      try {
        const mime = newDoc.fileType;
        extractedData = await OCRService.parseReceipt(`data:${mime};base64,${rawBuffer.toString('base64')}`, mime);
        validationResult = await OCRService.validateExtractedData(companyId, extractedData, fileHash, docId);

        const totalCentavos = Math.round(extractedData.totalAmount * 100);
        const vatCentavos = Math.round(extractedData.vatAmount * 100);
        const vatableSalesCentavos = Math.round(extractedData.vatableSales * 100);
        const vatExemptCentavos = Math.round(extractedData.vatExemptSales * 100);
        const zeroRatedCentavos = Math.round(extractedData.zeroRatedSales * 100);
        const withholdingCentavos = Math.round(extractedData.withholdingTax * 100);

        await db.update(schema.documents).set({
          documentType: extractedData.documentType || newDoc.documentType,
          ocrStatus: extractedData.needsReview ? 'MANUAL_REVIEW_REQUIRED' : 'COMPLETED',
          ocrResult: JSON.stringify(extractedData),
          confidenceScore: typeof extractedData.confidenceScore === 'number' ? extractedData.confidenceScore : 0,
          extractedMerchant: extractedData.merchant,
          extractedCustomer: extractedData.customer,
          extractedTin: extractedData.tin,
          extractedAddress: extractedData.address,
          extractedInvoiceNumber: extractedData.invoiceNumber,
          extractedDate: extractedData.date,
          extractedTotalAmount: totalCentavos,
          extractedVatAmount: vatCentavos,
          extractedVatableSales: vatableSalesCentavos,
          extractedVatExemptSales: vatExemptCentavos,
          extractedZeroRatedSales: zeroRatedCentavos,
          extractedWithholdingTax: withholdingCentavos,
          extractedPaymentMethod: extractedData.paymentMethod,
          extractedCategory: extractedData.category,
          extractionEngine: extractedData.extractionEngine || 'TESSERACT_WASM',
          pageCount: extractedData.pageCount || 1,
          validationErrors: JSON.stringify(validationResult.errors || []),
          validationWarnings: JSON.stringify(validationResult.warnings || []),
          linkedVendorId: validationResult.matchedVendorId || null,
          linkedCustomerId: validationResult.matchedCustomerId || null,
          updatedAt: new Date()
        }).where(eq(schema.documents.id, docId));

      } catch (ocrErr: any) {
        console.warn("[Documents API] Auto-OCR failed:", ocrErr.message);
        await db.update(schema.documents).set({
          ocrStatus: 'FAILED',
          validationErrors: JSON.stringify([`OCR Extraction error: ${ocrErr.message}`]),
          updatedAt: new Date()
        }).where(eq(schema.documents.id, docId));
      }
    }

    // 1. Audit Log Entry
    const auditId = await AuditService.log({
      req,
      companyId,
      action: "UPLOAD_DOCUMENT",
      entityType: "DOCUMENT",
      entityId: docId,
      entityName: fileName,
      recordReference: docId,
      module: "DOCUMENTS",
      afterData: newDoc,
      metadata: { fileName, documentType: newDoc.documentType, fileSize: calculatedSize, isDuplicate, duplicateDocId }
    });

    // 2. Broadcast Notification
    await broadcastNotification({
      companyId,
      title: "New Document Uploaded",
      message: `${fileName} (${newDoc.documentType}) was uploaded by ${req.user!.displayName || 'a team member'}.${isDuplicate ? ' (Duplicate Detected)' : ''}`,
      type: "DOCUMENT_UPLOAD",
      entityType: "document",
      entityId: docId,
      metadata: { fileName, uploadedBy: req.user!.displayName, docId, isDuplicate }
    });

    res.status(201).json({
      message: "Document uploaded successfully",
      documentId: docId,
      document: {
        ...newDoc,
        uploaderName: req.user!.displayName,
        uploaderEmail: req.user!.email,
      },
      extractedData,
      validationResult,
      isDuplicate,
      duplicateDocId
    });
  } catch (error: any) {
    console.error("[Documents API] Upload failed:", error);
    res.status(500).json({ error: "UPLOAD_FAILED", message: error.message });
  }
});

// =========================================================================
// 4B. MULTIPART STREAMING UPLOAD PIPELINE (50MB MAX, MIME & QUARANTINE CHECKS)
// =========================================================================
router.post("/upload-stream", requireAuth, requirePermission('documents:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: "BAD_REQUEST", message: "Expected multipart/form-data" });
    return;
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max limit
  const docId = crypto.randomUUID();
  const tempPath = await CompanyStorageService.getTempFilePath(companyId, `${docId}.tmp`);

  let fileError: Error | null = null;
  let originalFileName = `stream-${docId}.bin`;
  let mimeType = 'application/octet-stream';
  let documentType = 'GENERAL_ATTACHMENT';
  let entityType = 'GENERAL';
  let entityId = 'NONE';
  let notes: string | null = null;
  let bytesWritten = 0;
  let magicBuffer = Buffer.alloc(0);
  let isQuarantined = false;
  let quarantineReason: string | null = null;
  let fileFieldReceived = false;

  const bb = Busboy({
    headers: req.headers,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1
    }
  });

  const writeStream = fsSync.createWriteStream(tempPath);
  writeStream.on('error', () => {
    // Avoid unhandled stream error events during abort
  });

  bb.on('field', (name, val) => {
    if (name === 'documentType') documentType = val;
    else if (name === 'entityType') entityType = val;
    else if (name === 'entityId') entityId = val;
    else if (name === 'notes') notes = val;
  });

  bb.on('file', (name, fileStream, info) => {
    fileFieldReceived = true;
    originalFileName = info.filename || originalFileName;
    mimeType = info.mimeType || mimeType;

    const ext = path.extname(originalFileName).toLowerCase();
    const dangerousExts = ['.exe', '.bat', '.cmd', '.sh', '.bin', '.dll', '.msi', '.vbs', '.ps1', '.py', '.php'];
    if (dangerousExts.includes(ext)) {
      isQuarantined = true;
      quarantineReason = `Disallowed executable file extension: ${ext}`;
    }

    fileStream.on('data', (data: Buffer) => {
      if (fileError || writeStream.destroyed || writeStream.writableEnded) return;
      bytesWritten += data.length;
      if (magicBuffer.length < 16) {
        magicBuffer = Buffer.concat([magicBuffer, data]).subarray(0, 16);
      }
      writeStream.write(data);
    });

    fileStream.on('limit', () => {
      fileError = new Error(`FILE_TOO_LARGE: Upload exceeded maximum permitted size of 50MB.`);
      fileStream.resume(); // drain incoming socket chunks
      if (!writeStream.destroyed && !writeStream.writableEnded) {
        writeStream.end();
      }
    });

    fileStream.on('error', (err) => {
      fileError = err;
      if (!writeStream.destroyed && !writeStream.writableEnded) {
        writeStream.end();
      }
    });

    fileStream.on('end', () => {
      if (!writeStream.destroyed && !writeStream.writableEnded) {
        writeStream.end();
      }
    });
  });

  bb.on('error', (err: any) => {
    fileError = err instanceof Error ? err : new Error(String(err));
  });

  bb.on('finish', async () => {
    await new Promise<void>((resolve) => {
      if (writeStream.closed || writeStream.destroyed) resolve();
      else writeStream.on('finish', resolve);
    });

    if (fileError) {
      await fs.unlink(tempPath).catch(() => {});
      res.status(400).json({ error: "UPLOAD_ERROR", message: fileError.message });
      return;
    }

    if (!fileFieldReceived || bytesWritten === 0) {
      await fs.unlink(tempPath).catch(() => {});
      res.status(400).json({ error: "EMPTY_FILE", message: "Uploaded file is empty or no file stream received" });
      return;
    }

    // Inspect magic bytes for content verification
    if (magicBuffer.length >= 4) {
      if (magicBuffer[0] === 0x25 && magicBuffer[1] === 0x50 && magicBuffer[2] === 0x44 && magicBuffer[3] === 0x46) {
        mimeType = 'application/pdf';
      } else if (magicBuffer[0] === 0x89 && magicBuffer[1] === 0x50 && magicBuffer[2] === 0x4E && magicBuffer[3] === 0x47) {
        mimeType = 'image/png';
      } else if (magicBuffer[0] === 0xFF && magicBuffer[1] === 0xD8 && magicBuffer[2] === 0xFF) {
        mimeType = 'image/jpeg';
      }
    }

    try {
      const finalizeResult = await CompanyStorageService.finalizeStreamedUpload(
        companyId,
        docId,
        tempPath,
        originalFileName,
        {
          contentType: mimeType,
          quarantine: isQuarantined,
        }
      );

      const newDoc = {
        id: docId,
        companyId,
        entityType,
        entityId,
        documentType,
        fileName: originalFileName,
        originalFileName,
        fileType: mimeType,
        fileSize: bytesWritten,
        fileHash: finalizeResult.fileHash,
        filePath: finalizeResult.filePath,
        encryptionStatus: isQuarantined ? 'QUARANTINED' : 'ENCRYPTED_AES256_GCM',
        storageTier: isQuarantined ? 'QUARANTINE' : 'ORIGINALS',
        quarantineReason,
        source: 'STREAM_API',
        uploadedBy: req.user!.id,
        status: isQuarantined ? 'ARCHIVED' : 'ACTIVE',
        ocrStatus: isQuarantined ? 'REJECTED' : 'PENDING',
        verificationStatus: 'UNVERIFIED',
        notes,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const companyDb = await CompanyManager.getCompanyDb(companyId);
      await dbContext.run(companyDb, async () => {
        try {
          await db.insert(schema.documents).values(newDoc);
        } catch (dbErr: any) {
          await CompanyStorageService.cleanupFailedUpload(finalizeResult.filePath);
          throw dbErr;
        }

        await AuditService.log({
          req,
          companyId,
          action: isQuarantined ? "QUARANTINE_DOCUMENT" : "STREAM_UPLOAD_DOCUMENT",
          entityType: "DOCUMENT",
          entityId: docId,
          entityName: originalFileName,
          recordReference: docId,
          module: "DOCUMENTS",
          afterData: newDoc,
          metadata: { fileName: originalFileName, fileSize: bytesWritten, fileHash: finalizeResult.fileHash, isQuarantined, quarantineReason }
        });
      });

      res.status(201).json({
        success: true,
        message: isQuarantined ? "File quarantined due to security policy" : "File streamed and encrypted successfully",
        documentId: docId,
        document: newDoc,
        isQuarantined,
        quarantineReason
      });
    } catch (finalizeErr: any) {
      await fs.unlink(tempPath).catch(() => {});
      console.error("[Documents API] Stream upload finalize error:", finalizeErr);
      res.status(500).json({ error: "FINALIZE_ERROR", message: finalizeErr.message });
    }
  });

  req.pipe(bb);
});

// =========================================================================
// 4C. REPOSITORY AUDIT DIAGNOSTICS & RETENTION
// =========================================================================
router.get("/diagnostics/audit", requireAuth, requirePermission('documents:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const report = await CompanyStorageService.auditDocumentRepository(companyId);
    res.json(report);
  } catch (error: any) {
    console.error("[Documents API] Repository audit error:", error);
    res.status(500).json({ error: "AUDIT_ERROR", message: error.message });
  }
});

router.post("/diagnostics/migrate-legacy", requireAuth, requirePermission('documents:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const allDocs = await db.select().from(schema.documents).where(eq(schema.documents.companyId, companyId));
    const migrated: string[] = [];
    const errors: any[] = [];

    for (const doc of allDocs) {
      try {
        let physicalFile = doc.filePath;
        try {
          await fs.access(physicalFile);
        } catch {
          physicalFile = await CompanyStorageService.resolveDocumentPath(companyId, path.basename(doc.filePath));
        }

        const buf = await fs.readFile(physicalFile);
        if (!(await DocumentEncryptionService.isEncryptedContainer(buf))) {
          const migResult = await DocumentEncryptionService.migratePlaintextFile(
            companyId,
            doc.id,
            physicalFile,
            undefined,
            doc.originalFileName || doc.fileName
          );

          await db.update(schema.documents).set({
            filePath: migResult.newEncryptedPath,
            fileHash: migResult.fileHash,
            encryptionStatus: 'ENCRYPTED_AES256_GCM',
            storageTier: 'ORIGINALS',
            updatedAt: new Date()
          }).where(eq(schema.documents.id, doc.id));

          migrated.push(doc.id);
        } else if (doc.encryptionStatus !== 'ENCRYPTED_AES256_GCM') {
          await db.update(schema.documents).set({
            encryptionStatus: 'ENCRYPTED_AES256_GCM',
            updatedAt: new Date()
          }).where(eq(schema.documents.id, doc.id));
        }
      } catch (docErr: any) {
        errors.push({ id: doc.id, error: docErr.message });
      }
    }

    res.json({ success: true, count: migrated.length, migrated, errors });
  } catch (error: any) {
    console.error("[Documents API] Migration error:", error);
    res.status(500).json({ error: "MIGRATION_ERROR", message: error.message });
  }
});

router.post("/diagnostics/cleanup-temp", requireAuth, requirePermission('documents:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const cleanedCount = await CompanyStorageService.cleanupTempFiles(companyId, 3600 * 1000);
    res.json({ success: true, cleanedCount });
  } catch (error: any) {
    console.error("[Documents API] Temp cleanup error:", error);
    res.status(500).json({ error: "CLEANUP_ERROR", message: error.message });
  }
});

// =========================================================================
// 5. TRIGGER OCR ON EXISTING DOCUMENT
// =========================================================================
router.post("/:id/ocr", requireAuth, requirePermission('documents:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const doc = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
    .get();

  if (!doc) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
    return;
  }

  try {
    await db.update(schema.documents)
      .set({ ocrStatus: 'PROCESSING', updatedAt: new Date() })
      .where(eq(schema.documents.id, id));

    let fileBuffer: Buffer;
    try {
      const rawDiskBuffer = await fs.readFile(doc.filePath);
      if (DocumentEncryptionService.isEncryptedContainer(rawDiskBuffer)) {
        const dec = DocumentEncryptionService.decryptBuffer(companyId, doc.id, rawDiskBuffer);
        fileBuffer = dec.plainBuffer;
      } else {
        fileBuffer = rawDiskBuffer;
      }
    } catch (fileErr: any) {
      return res.status(404).json({
        error: "DOCUMENT_FILE_MISSING",
        message: `Stored document binary is unavailable or failed decryption (${fileErr?.message || 'Read error'}).`,
      });
    }

    const base64File = fileBuffer.toString('base64');
    const mimeType = doc.fileType || (doc.fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    const result = await OCRService.parseReceipt(`data:${mimeType};base64,${base64File}`, mimeType);
    const fileHash = doc.fileHash || OCRService.calculateFileHash(fileBuffer);
    const validationResult = await OCRService.validateExtractedData(companyId, result, fileHash, id);

    const totalCentavos = Math.round(result.totalAmount * 100);
    const vatCentavos = Math.round(result.vatAmount * 100);
    const vatableSalesCentavos = Math.round(result.vatableSales * 100);
    const vatExemptCentavos = Math.round(result.vatExemptSales * 100);
    const zeroRatedCentavos = Math.round(result.zeroRatedSales * 100);
    const withholdingCentavos = Math.round(result.withholdingTax * 100);

    await db.update(schema.documents)
      .set({
        documentType: result.documentType || doc.documentType,
        ocrStatus: 'COMPLETED',
        ocrResult: JSON.stringify(result),
        confidenceScore: result.confidenceScore || 0.90,
        fileHash,
        extractedMerchant: result.merchant,
        extractedCustomer: result.customer,
        extractedTin: result.tin,
        extractedAddress: result.address,
        extractedInvoiceNumber: result.invoiceNumber,
        extractedDate: result.date,
        extractedTotalAmount: totalCentavos,
        extractedVatAmount: vatCentavos,
        extractedVatableSales: vatableSalesCentavos,
        extractedVatExemptSales: vatExemptCentavos,
        extractedZeroRatedSales: zeroRatedCentavos,
        extractedWithholdingTax: withholdingCentavos,
        extractedPaymentMethod: result.paymentMethod,
        extractedCategory: result.category,
        extractionEngine: result.extractionEngine || 'TESSERACT_WASM',
        pageCount: result.pageCount || 1,
        validationErrors: JSON.stringify(validationResult.errors || []),
        validationWarnings: JSON.stringify(validationResult.warnings || []),
        linkedVendorId: validationResult.matchedVendorId || doc.linkedVendorId,
        linkedCustomerId: validationResult.matchedCustomerId || doc.linkedCustomerId,
        updatedAt: new Date()
      })
      .where(eq(schema.documents.id, id));

    await AuditService.log({
      req,
      companyId,
      action: "PROCESS_DOCUMENT_OCR",
      entityType: "DOCUMENT",
      entityId: id,
      entityName: doc.fileName,
      recordReference: id,
      module: "DOCUMENTS",
      afterData: result,
      metadata: { invoiceNumber: result.invoiceNumber, totalAmount: result.totalAmount, merchant: result.merchant }
    });

    res.json({
      success: true,
      result,
      validationResult
    });
  } catch (error: any) {
    console.error("[Documents API] OCR Error:", error);
    await db.update(schema.documents)
      .set({
        ocrStatus: 'FAILED',
        validationErrors: JSON.stringify([`OCR Failed: ${error.message}`]),
        updatedAt: new Date()
      })
      .where(eq(schema.documents.id, id));

    res.status(500).json({ error: "OCR_FAILED", message: error.message });
  }
});

// =========================================================================
// 6. HUMAN OCR VERIFICATION & CORRECTION REVIEW
// =========================================================================
router.put("/:id/ocr-review", requireAuth, requirePermission('documents:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const {
    documentType,
    merchant,
    customer,
    tin,
    address,
    invoiceNumber,
    date,
    totalAmount,
    vatAmount,
    vatableSales,
    vatExemptSales,
    zeroRatedSales,
    withholdingTax,
    paymentMethod,
    category,
    items,
    verificationStatus = 'VERIFIED', // VERIFIED, REJECTED, UNVERIFIED
    notes
  } = req.body;

  const doc = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
    .get();

  if (!doc) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
    return;
  }

  try {
    const totalNum = OCRService.normalizeAmount(totalAmount);
    const vatNum = OCRService.normalizeAmount(vatAmount);
    const vatableNum = OCRService.normalizeAmount(vatableSales || (vatNum > 0 ? vatNum / 0.12 : totalNum - vatNum));
    const subtotalNum = vatableNum + OCRService.normalizeAmount(vatExemptSales || 0) + OCRService.normalizeAmount(zeroRatedSales || 0);

    const updatedExtracted: ExtractedDocumentData = {
      documentType: documentType || doc.documentType,
      merchant: merchant ? merchant.trim() : (doc.extractedMerchant || ''),
      customer: customer ? customer.trim() : (doc.extractedCustomer || ''),
      tin: OCRService.normalizeTin(tin || doc.extractedTin || ''),
      address: address ? address.trim() : (doc.extractedAddress || ''),
      invoiceNumber: invoiceNumber ? invoiceNumber.trim() : (doc.extractedInvoiceNumber || ''),
      date: OCRService.normalizeDate(date || doc.extractedDate),
      paymentMethod: (paymentMethod || doc.extractedPaymentMethod || 'CASH').toUpperCase(),
      category: category || doc.extractedCategory || 'Office Supplies',
      items: Array.isArray(items) ? items : [],
      subtotal: subtotalNum,
      discount: 0,
      vatableSales: vatableNum,
      vatExemptSales: OCRService.normalizeAmount(vatExemptSales || 0),
      zeroRatedSales: OCRService.normalizeAmount(zeroRatedSales || 0),
      vatAmount: vatNum,
      withholdingTax: OCRService.normalizeAmount(withholdingTax || 0),
      totalAmount: totalNum,
      confidenceScore: 1.0, // Human verified
      summary: `${merchant || 'Document'} - ${invoiceNumber || 'Invoice'}`,
      extractionEngine: 'TESSERACT_WASM',
      pageCount: 1,
      needsReview: false
    };

    const validationResult = await OCRService.validateExtractedData(companyId, updatedExtracted, doc.fileHash || undefined, id);

    const totalCentavos = Math.round(totalNum * 100);
    const vatCentavos = Math.round(vatNum * 100);
    const vatableSalesCentavos = Math.round(vatableNum * 100);
    const vatExemptCentavos = Math.round(OCRService.normalizeAmount(vatExemptSales || 0) * 100);
    const zeroRatedCentavos = Math.round(OCRService.normalizeAmount(zeroRatedSales || 0) * 100);
    const withholdingCentavos = Math.round(OCRService.normalizeAmount(withholdingTax || 0) * 100);

    const newOcrStatus = verificationStatus === 'VERIFIED' ? 'APPROVED' : (verificationStatus === 'REJECTED' ? 'REJECTED' : 'COMPLETED');

    await db.update(schema.documents)
      .set({
        documentType: updatedExtracted.documentType,
        verificationStatus,
        ocrStatus: newOcrStatus,
        ocrResult: JSON.stringify(updatedExtracted),
        extractedMerchant: updatedExtracted.merchant,
        extractedCustomer: updatedExtracted.customer,
        extractedTin: updatedExtracted.tin,
        extractedAddress: updatedExtracted.address,
        extractedInvoiceNumber: updatedExtracted.invoiceNumber,
        extractedDate: updatedExtracted.date,
        extractedTotalAmount: totalCentavos,
        extractedVatAmount: vatCentavos,
        extractedVatableSales: vatableSalesCentavos,
        extractedVatExemptSales: vatExemptCentavos,
        extractedZeroRatedSales: zeroRatedCentavos,
        extractedWithholdingTax: withholdingCentavos,
        extractedPaymentMethod: updatedExtracted.paymentMethod,
        extractedCategory: updatedExtracted.category,
        validationErrors: JSON.stringify(validationResult.errors || []),
        validationWarnings: JSON.stringify(validationResult.warnings || []),
        linkedVendorId: validationResult.matchedVendorId || doc.linkedVendorId,
        linkedCustomerId: validationResult.matchedCustomerId || doc.linkedCustomerId,
        notes: notes !== undefined ? notes : doc.notes,
        verifiedBy: req.user!.id,
        verifiedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(schema.documents.id, id));

    await AuditService.log({
      req,
      companyId,
      action: verificationStatus === 'VERIFIED' ? "VERIFY_DOCUMENT_OCR" : "REJECT_DOCUMENT_OCR",
      entityType: "DOCUMENT",
      entityId: id,
      entityName: doc.fileName,
      recordReference: id,
      module: "DOCUMENTS",
      beforeData: { verificationStatus: doc.verificationStatus, ocrStatus: doc.ocrStatus },
      afterData: { verificationStatus, ocrStatus: newOcrStatus, updatedExtracted },
      metadata: { invoiceNumber: updatedExtracted.invoiceNumber, totalAmount: totalNum, verifiedBy: req.user!.displayName }
    });

    await broadcastNotification({
      companyId,
      title: verificationStatus === 'VERIFIED' ? "Document Verified" : "Document Review Updated",
      message: `${doc.fileName} was ${verificationStatus.toLowerCase()} by ${req.user!.displayName}.`,
      type: "DOCUMENT_UPLOAD",
      entityType: "document",
      entityId: id,
      metadata: { fileName: doc.fileName, verificationStatus }
    });

    res.json({
      success: true,
      message: `Document successfully updated and set to ${verificationStatus}`,
      document: {
        ...doc,
        verificationStatus,
        ocrStatus: newOcrStatus,
        extractedMerchant: updatedExtracted.merchant,
        extractedInvoiceNumber: updatedExtracted.invoiceNumber,
        extractedTotalAmount: totalCentavos
      },
      validationResult
    });
  } catch (error: any) {
    console.error("[Documents API] Human review error:", error);
    res.status(500).json({ error: "REVIEW_FAILED", message: error.message });
  }
});

// =========================================================================
// 7. POST VERIFIED DOCUMENT DIRECTLY TO ACCOUNTING (PURCHASE BILL, EXPENSE, SALES INVOICE, JOURNAL ENTRY)
// =========================================================================
router.post("/:id/post-accounting", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const {
    targetTransactionType = 'PURCHASE_BILL', // PURCHASE_BILL, SALES_INVOICE, EXPENSE, JOURNAL_ENTRY
    vendorId,
    customerId,
    expenseAccountId,
    revenueAccountId,
    cashAccountId,
    paymentMethod,
    autoApproveAndPost = false,
    notes
  } = req.body;

  const doc = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
    .get();

  if (!doc) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
    return;
  }

  // Ensure document is not already posted
  if (doc.verificationStatus === 'POSTED_TO_ACCOUNTING' && doc.linkedTransactionId && doc.linkedTransactionId !== 'NONE') {
    res.status(400).json({
      error: "ALREADY_POSTED",
      message: `Document is already linked and posted to transaction (${doc.linkedTransactionType}: ${doc.linkedTransactionId})`
    });
    return;
  }

  // Ensure document is human-verified before posting to General Ledger
  if (doc.verificationStatus !== 'VERIFIED' && !autoApproveAndPost) {
    res.status(400).json({
      error: "UNVERIFIED_DOCUMENT",
      message: `Document '${doc.fileName}' must be human-verified before posting to General Ledger. Current status is ${doc.verificationStatus}. OCR staging payloads require explicit human review.`
    });
    return;
  }

  try {
    const { resolveCompanyControlAccount } = await import("../db/business_transactions");
    const accMap = await AccountingEngine.ensureDefaultAccounts(companyId);
    const resolvedAp = await resolveCompanyControlAccount(db, companyId, "AP").catch(() => null);
    const resolvedAr = await resolveCompanyControlAccount(db, companyId, "AR").catch(() => null);
    const resolvedExp = await resolveCompanyControlAccount(db, companyId, "EXPENSE").catch(() => null);
    const resolvedRev = await resolveCompanyControlAccount(db, companyId, "REVENUE").catch(() => null);
    const resolvedCash = await resolveCompanyControlAccount(db, companyId, "CASH").catch(() => null);
    const resolvedInputVat = await resolveCompanyControlAccount(db, companyId, "INPUT_VAT").catch(() => null);
    const amountCentavos = doc.extractedTotalAmount || 0;
    const vatCentavos = doc.extractedVatAmount || 0;
    const netCentavos = Math.max(0, amountCentavos - vatCentavos);
    const docDate = doc.extractedDate || new Date().toISOString().split('T')[0];
    const docNumber = doc.extractedInvoiceNumber || `DOC-${Math.floor(100000 + Math.random() * 900000)}`;

    let createdTxId = '';
    let createdTxType = targetTransactionType;

    if (targetTransactionType === 'PURCHASE_BILL') {
      // 1. Resolve or Auto-Create Vendor
      let finalVendorId = vendorId || doc.linkedVendorId;
      if (!finalVendorId) {
        const vendorName = doc.extractedMerchant || "General Supplier";
        const newVendorId = crypto.randomUUID();
        const vendorCode = `VEND-${Math.floor(1000 + Math.random() * 9000)}`;
        
        await db.insert(schema.vendors).values({
          id: newVendorId,
          companyId,
          code: vendorCode,
          legalName: vendorName,
          tin: doc.extractedTin || "000-000-000-000",
          address: doc.extractedAddress || "Philippines",
          taxClassification: vatCentavos > 0 ? "VAT_REGISTERED" : "NON_VAT",
          vatStatus: vatCentavos > 0 ? "VAT" : "NON_VAT",
          defaultPayableAccountId: resolvedAp?.id || accMap["2000"]?.id,
          defaultExpenseAccountId: expenseAccountId || resolvedExp?.id || accMap["6000"]?.id || accMap["5000"]?.id,
          status: "ACTIVE"
        }).onConflictDoNothing();
        finalVendorId = newVendorId;
      }

      // Create Purchase Bill
      const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
      const billId = await createPurchaseBill(companyId, {
        vendorId: finalVendorId,
        billNumber: docNumber,
        billDate: docDate,
        totalAmount: amountCentavos,
        reference: `OCR Source: ${doc.fileName}`,
        notes: notes || doc.notes || `Created from OCR document ${doc.fileName}`,
        lines: [
          {
            accountId: expenseAccountId || resolvedExp?.id || accMap["6000"]?.id || accMap["5000"]?.id,
            description: doc.extractedMerchant ? `Expenses / Purchases from ${doc.extractedMerchant}` : doc.fileName,
            quantity: 1,
            unitPrice: netCentavos || amountCentavos,
            amount: netCentavos || amountCentavos,
          }
        ]
      }, req.user!.id, actorRole);

      createdTxId = billId;
      createdTxType = 'PURCHASE_BILL';

    } else if (targetTransactionType === 'SALES_INVOICE') {
      // 2. Resolve or Auto-Create Customer
      let finalCustomerId = customerId || doc.linkedCustomerId;
      if (!finalCustomerId) {
        const customerName = doc.extractedCustomer || "Cash Customer";
        const newCustId = crypto.randomUUID();
        const custCode = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

        await db.insert(schema.customers).values({
          id: newCustId,
          companyId,
          code: custCode,
          legalName: customerName,
          tin: doc.extractedTin || "000-000-000-000",
          address: doc.extractedAddress || "Philippines",
          taxClassification: "VAT_REGISTERED",
          vatStatus: "VAT",
          defaultReceivableAccountId: resolvedAr?.id || accMap["1200"]?.id,
          defaultRevenueAccountId: revenueAccountId || resolvedRev?.id || accMap["4000"]?.id,
          status: "ACTIVE"
        }).onConflictDoNothing();
        finalCustomerId = newCustId;
      }

      // Create Sales Invoice
      const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
      const invoiceId = await createSalesInvoice(companyId, {
        customerId: finalCustomerId,
        invoiceNumber: docNumber,
        invoiceDate: docDate,
        totalAmount: amountCentavos,
        reference: `OCR Source: ${doc.fileName}`,
      }, req.user!.id, actorRole);

      createdTxId = invoiceId;
      createdTxType = 'SALES_INVOICE';

    } else if (targetTransactionType === 'EXPENSE' || targetTransactionType === 'JOURNAL_ENTRY') {
      // 3. Post Direct Balanced Double-Entry Journal Entry
      const chosenExpenseAcc = expenseAccountId || resolvedExp?.id || accMap["6000"]?.id || accMap["5000"]?.id;
      const chosenCashAcc = cashAccountId || resolvedCash?.id || accMap["1100"]?.id;

      const lines: any[] = [];
      
      // Debit Net Expense
      if (netCentavos > 0) {
        lines.push({
          accountId: chosenExpenseAcc,
          debit: netCentavos,
          credit: 0,
          description: `${doc.extractedMerchant || 'Expense'} - ${doc.fileName}`
        });
      }

      // Debit Input VAT if VAT was extracted
      if (vatCentavos > 0) {
        lines.push({
          accountId: resolvedInputVat?.id || accMap["1500"]?.id,
          debit: vatCentavos,
          credit: 0,
          description: `Input VAT (12%) - ${docNumber}`
        });
      }

      // If no net split, debit whole amount to expense
      if (lines.length === 0 && amountCentavos > 0) {
        lines.push({
          accountId: chosenExpenseAcc,
          debit: amountCentavos,
          credit: 0,
          description: `${doc.extractedMerchant || 'Expense'} - ${doc.fileName}`
        });
      }

      // Credit Cash / Bank / AP
      lines.push({
        accountId: chosenCashAcc || resolvedAp?.id || accMap["2000"]?.id,
        debit: 0,
        credit: amountCentavos,
        description: `Disbursement / Settlement for ${docNumber}`
      });

      const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
      const journalId = await AccountingEngine.postBalancedJournalEntry(companyId, {
        journalNumber: `JE-OCR-${docNumber}`,
        entryDate: docDate,
        description: `OCR Source Evidence Posting: ${doc.extractedMerchant || ''} (${doc.fileName})`,
        sourceType: "documents",
        sourceId: id,
        createdBy: req.user!.id,
        userRole: actorRole
      }, lines);

      createdTxId = journalId;
      createdTxType = 'JOURNAL_ENTRY';
    }

    // Update document with linked accounting transaction and mark posted
    await db.update(schema.documents).set({
      verificationStatus: 'POSTED_TO_ACCOUNTING',
      ocrStatus: 'APPROVED',
      linkedTransactionType: createdTxType,
      linkedTransactionId: createdTxId,
      verifiedBy: req.user!.id,
      verifiedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(schema.documents.id, id));

    // Audit log
    await AuditService.log({
      req,
      companyId,
      action: "POST_DOCUMENT_TO_ACCOUNTING",
      entityType: "DOCUMENT",
      entityId: id,
      entityName: doc.fileName,
      recordReference: createdTxId,
      module: "DOCUMENTS",
      afterData: { targetTransactionType: createdTxType, transactionId: createdTxId, amountCentavos },
      metadata: { invoiceNumber: docNumber, transactionType: createdTxType, transactionId: createdTxId }
    });

    // Realtime notification
    await broadcastNotification({
      companyId,
      title: "Document Posted to Accounting",
      message: `${doc.fileName} was successfully posted to accounting as ${createdTxType} (#${docNumber}).`,
      type: "JOURNAL_CREATED",
      entityType: "document",
      entityId: id,
      metadata: { fileName: doc.fileName, transactionType: createdTxType, transactionId: createdTxId }
    });

    res.json({
      success: true,
      message: `Document successfully posted to accounting as ${createdTxType}`,
      transactionType: createdTxType,
      transactionId: createdTxId,
      documentId: id
    });
  } catch (error: any) {
    console.error("[Documents API] Accounting posting failed:", error);
    const status = error?.statusCode || 500;
    res.status(status).json({ error: error?.code || "POSTING_FAILED", message: error.message });
  }
});

// =========================================================================
// 8. MANUALLY LINK DOCUMENT TO EXISTING TRANSACTION
// =========================================================================
router.put("/:id/link", requireAuth, requirePermission('documents:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const { linkedTransactionType, linkedTransactionId, linkedVendorId, linkedCustomerId } = req.body;

  const doc = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
    .get();

  if (!doc) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
    return;
  }

  try {
    await db.update(schema.documents).set({
      linkedTransactionType: linkedTransactionType || null,
      linkedTransactionId: linkedTransactionId || null,
      linkedVendorId: linkedVendorId || doc.linkedVendorId,
      linkedCustomerId: linkedCustomerId || doc.linkedCustomerId,
      verificationStatus: linkedTransactionId ? 'POSTED_TO_ACCOUNTING' : doc.verificationStatus,
      updatedAt: new Date()
    }).where(eq(schema.documents.id, id));

    await AuditService.log({
      req,
      companyId,
      action: "LINK_DOCUMENT_TRANSACTION",
      entityType: "DOCUMENT",
      entityId: id,
      entityName: doc.fileName,
      recordReference: linkedTransactionId || 'UNLINKED',
      module: "DOCUMENTS",
      afterData: { linkedTransactionType, linkedTransactionId },
      metadata: { linkedTransactionType, linkedTransactionId }
    });

    res.json({ success: true, message: "Document transaction link updated successfully" });
  } catch (error: any) {
    console.error("[Documents API] Transaction linking failed:", error);
    res.status(500).json({ error: "LINK_FAILED", message: error.message });
  }
});

// =========================================================================
// 9. DELETE / ARCHIVE DOCUMENT
// =========================================================================
router.delete("/:id", requireAuth, requirePermission('documents:delete'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const doc = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.id, id), eq(schema.documents.companyId, companyId)))
    .get();

  if (!doc) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found" });
    return;
  }

  try {
    await db.update(schema.documents)
      .set({ status: "DELETED", updatedAt: new Date() })
      .where(eq(schema.documents.id, id));

    const auditId = await AuditService.log({
      req,
      companyId,
      action: "DOCUMENT_ARCHIVED",
      entityType: "DOCUMENT",
      entityId: id,
      entityName: doc.fileName,
      module: "DOCUMENTS",
      beforeData: { status: doc.status },
      afterData: { status: "DELETED" },
      metadata: { fileName: doc.fileName }
    });

    await broadcastNotification({
      companyId,
      title: "Document Removed",
      message: `${doc.fileName} was moved to deleted archive by ${req.user!.displayName || 'user'}.`,
      type: "DOCUMENT_UPLOAD",
      entityType: "document",
      entityId: id,
      metadata: { fileName: doc.fileName, deletedBy: req.user!.displayName }
    });

    res.json({ success: true, message: "Document deleted successfully" });
  } catch (error: any) {
    console.error("[Documents API] Document deletion failed:", error);
    res.status(500).json({ error: "DELETE_FAILED", message: error.message });
  }
});

// =========================================================================
// 10. HARDWARE SCANNER & PRINTER DEVICE DETECTOR ENDPOINTS
// =========================================================================

// Detect Connected Scanner Hardware Devices (USB, TWAIN/WIA, LAN eSCL/AirScan)
router.get("/scanners/detect", requireAuth, async (_req, res) => {
  try {
    const detectedScanners: any[] = [];

    res.json({
      success: true,
      hardwareBridgeAvailable: false,
      totalDetected: detectedScanners.length,
      scanners: detectedScanners,
      message: "No physical TWAIN/WIA/eSCL hardware scanner bridge detected in this environment. Upload digital documents or use camera capture.",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: "SCANNER_DETECTION_FAILED", message: error.message });
  }
});

// Execute Direct Hardware Scanner Acquisition (Direct Intake into System)
router.post("/scanners/scan-direct", requireAuth, async (req, res) => {
  const { scannerId } = req.body;
  res.status(400).json({
    error: "HARDWARE_SCANNER_NOT_CONNECTED",
    message: `Cannot acquire hardware scan: Scanner '${scannerId || 'UNSPECIFIED'}' is not physically connected or TWAIN/WIA/eSCL driver bridge is unavailable. Please upload actual document files directly.`
  });
});

// Continuous Batch ADF Scanner Endpoint
router.post("/scanners/scan-batch", requireAuth, async (req, res) => {
  const { scannerId } = req.body;
  res.status(400).json({
    error: "HARDWARE_SCANNER_NOT_CONNECTED",
    message: `Cannot execute ADF batch scan: Scanner '${scannerId || 'UNSPECIFIED'}' is not physically connected. Synthetic batch receipt generation is disabled to preserve financial integrity.`
  });
});

// Save All Scanned Batch Documents directly into the System DB
router.post("/scanners/save-batch", requireAuth, async (req, res) => {
  const { batchItems } = req.body;
  if (!Array.isArray(batchItems) || batchItems.length === 0) {
    return res.status(400).json({ error: "INVALID_BATCH_DATA", message: "No verified batch documents provided." });
  }
  res.status(400).json({
    error: "UNVERIFIED_BATCH_REJECTED",
    message: "Direct batch insertion without physical file encryption (LAISDOC1) and human OCR verification is disabled."
  });
});

// Detect Connected Printers
router.get("/printers/detect", requireAuth, async (_req, res) => {
  try {
    const detectedPrinters: any[] = [];

    res.json({
      success: true,
      hardwareBridgeAvailable: false,
      totalDetected: detectedPrinters.length,
      printers: detectedPrinters,
      message: "No physical USB/LAN thermal or laser printer bridge detected in this environment. Use browser print or PDF export.",
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: "PRINTER_DETECTION_FAILED", message: error.message });
  }
});

export default router;

