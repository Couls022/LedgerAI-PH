import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { OCRService } from '../../src/server/services/ocrService';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { createPurchaseBill, createSalesInvoice } from '../../src/server/db/business_transactions';

describe('Phase 4: Document Management & OCR Test Suite', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const docId1 = crypto.randomUUID();
  const docId2 = crypto.randomUUID();
  let defaultAccounts: Record<string, any> = {};

  beforeAll(async () => {
    await runInTestDb(async () => {
      // 1. Seed user and company
      await db.insert(schema.users).values({
        id: userId,
        email: `doc_user_${crypto.randomUUID()}@ledgerai.ph`,
        passwordHash: 'hash',
        displayName: 'Doc Auditor',
        role: 'Company Administrator'
      }).onConflictDoNothing();

      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Phase 4 Document Systems Inc.',
        tin: '987-654-321-000',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        documentLocationPath: '',
        backupLocationPath: '',
        status: 'ACTIVE'
      }).onConflictDoNothing();

      // Seed accounting period
      await db.insert(schema.accountingPeriods).values({
        id: crypto.randomUUID(),
        companyId,
        name: '2026 Annual',
        fiscalYear: 2026,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'OPEN'
      }).onConflictDoNothing();

      // Seed chart of accounts
      defaultAccounts = await AccountingEngine.ensureDefaultAccounts(companyId);
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      try {
        await db.delete(schema.documents).where(eq(schema.documents.companyId, companyId));
        await db.delete(schema.purchaseBillLines);
        await db.delete(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, companyId));
        await db.delete(schema.salesInvoiceLines);
        await db.delete(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, companyId));
        await db.delete(schema.journalLines);
        await db.delete(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId));
        await db.delete(schema.vendors).where(eq(schema.vendors.companyId, companyId));
        await db.delete(schema.customers).where(eq(schema.customers.companyId, companyId));
        await db.delete(schema.accounts).where(eq(schema.accounts.companyId, companyId));
        await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      } catch (_) {}
    });
  });

  it('1. should calculate deterministic SHA-256 file hashes and normalize Philippine TINs and dates', () => {
    const rawBuffer = Buffer.from('Official Receipt #12345 for Office Supplies');
    const hash = OCRService.calculateFileHash(rawBuffer);
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);

    // TIN normalization
    expect(OCRService.normalizeTin('123456789')).toBe('123-456-789-000');
    expect(OCRService.normalizeTin('123-456-789-000')).toBe('123-456-789-000');
    expect(OCRService.normalizeTin('123456789001')).toBe('123-456-789-001');

    // Date normalization
    expect(OCRService.normalizeDate('2026-08-16')).toBe('2026-08-16');
    expect(OCRService.normalizeDate('08/16/2026')).toBe('2026-08-16');
  });

  it('2. should perform arithmetic validation and detect variances', async () => {
    await runInTestDb(async () => {
      // Balanced test case (1000 subtotal + 120 VAT = 1120 total)
      const validData = OCRService.normalizeExtractedData({
        merchant: 'Makati Supplies Corp',
        tin: '123-456-789-000',
        invoiceNumber: 'INV-1001',
        date: '2026-08-16',
        subtotal: 1000,
        vatAmount: 120,
        vatableSales: 1000,
        totalAmount: 1120,
        items: [{ description: 'Paper', quantity: 1, unitPrice: 1000, amount: 1000 }]
      });

      const validation1 = await OCRService.validateExtractedData(companyId, validData);
      expect(validation1.isValid).toBe(true);
      expect(validation1.arithmeticMatches).toBe(true);
      expect(validation1.tinValid).toBe(true);

      // Variance test case (Subtotal 1000 + VAT 120 != Total 2000)
      const invalidData = OCRService.normalizeExtractedData({
        merchant: 'Makati Supplies Corp',
        tin: '123-456-789-000',
        invoiceNumber: 'INV-1002',
        date: '2026-08-16',
        subtotal: 1000,
        vatAmount: 120,
        vatableSales: 1000,
        totalAmount: 2000
      });

      const validation2 = await OCRService.validateExtractedData(companyId, invalidData);
      expect(validation2.arithmeticMatches).toBe(false);
      expect(validation2.warnings.some(w => w.includes('Arithmetic variance'))).toBe(true);
    });
  });

  it('3. should store document metadata and detect exact duplicate file hashes', async () => {
    await runInTestDb(async () => {
      const mockHash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';

      // Insert Doc 1
      await db.insert(schema.documents).values({
        id: docId1,
        companyId,
        entityType: 'PURCHASE_BILL',
        entityId: 'PB-1001',
        documentType: 'RECEIPT',
        fileName: 'Receipt_001.jpg',
        originalFileName: 'Receipt_001.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024 * 50,
        fileHash: mockHash,
        filePath: '/tmp/receipt_001.jpg',
        source: 'WEB_UI',
        uploadedBy: userId,
        status: 'ACTIVE',
        ocrStatus: 'COMPLETED',
        verificationStatus: 'UNVERIFIED',
        confidenceScore: 0.95,
        extractedMerchant: 'Office Depot PH',
        extractedTin: '222-333-444-000',
        extractedInvoiceNumber: 'OR-9988',
        extractedDate: '2026-08-16',
        extractedTotalAmount: 112000, // ₱1,120.00
        extractedVatAmount: 12000,    // ₱120.00
        extractedVatableSales: 100000,
        extractedPaymentMethod: 'CASH',
        extractedCategory: 'Office Supplies',
      });

      const duplicateCheck = await OCRService.validateExtractedData(
        companyId,
        {
          documentType: 'RECEIPT',
          merchant: 'Office Depot PH',
          customer: '',
          tin: '222-333-444-000',
          address: 'Manila',
          invoiceNumber: 'OR-9988',
          date: '2026-08-16',
          paymentMethod: 'CASH',
          category: 'Office Supplies',
          items: [],
          subtotal: 1000,
          discount: 0,
          vatableSales: 1000,
          vatExemptSales: 0,
          zeroRatedSales: 0,
          vatAmount: 120,
          withholdingTax: 0,
          totalAmount: 1120,
          confidenceScore: 0.95,
          summary: 'Office Supplies'
        },
        mockHash,
        docId2 // new doc ID
      );

      expect(duplicateCheck.isDuplicate).toBe(true);
      expect(duplicateCheck.duplicateDocumentId).toBe(docId1);
    });
  });

  it('4. should human-verify document and transition status from UNVERIFIED to VERIFIED', async () => {
    await runInTestDb(async () => {
      await db.update(schema.documents).set({
        verificationStatus: 'VERIFIED',
        ocrStatus: 'APPROVED',
        verifiedBy: userId,
        verifiedAt: new Date(),
        updatedAt: new Date()
      }).where(eq(schema.documents.id, docId1));

      const updated = await db.select().from(schema.documents).where(eq(schema.documents.id, docId1)).get();
      expect(updated!.verificationStatus).toBe('VERIFIED');
      expect(updated!.ocrStatus).toBe('APPROVED');
      expect(updated!.verifiedBy).toBe(userId);
    });
  });

  it('5. should post verified document to Accounting as a Purchase Bill and link transaction ID', async () => {
    await runInTestDb(async () => {
      const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, docId1)).get();
      expect(doc).toBeDefined();

      // Create vendor if not exists
      const vendorId = crypto.randomUUID();
      await db.insert(schema.vendors).values({
        id: vendorId,
        companyId,
        code: 'VEND-DEPOT',
        legalName: doc!.extractedMerchant || 'Office Depot PH',
        tin: doc!.extractedTin || '222-333-444-000',
        taxClassification: 'VAT_REGISTERED',
        vatStatus: 'VAT',
        defaultPayableAccountId: defaultAccounts["2000"]?.id,
        defaultExpenseAccountId: defaultAccounts["6000"]?.id,
        status: 'ACTIVE'
      });

      // Post Purchase Bill
      const billId = await createPurchaseBill(companyId, {
        vendorId,
        billNumber: doc!.extractedInvoiceNumber || 'OR-9988',
        billDate: doc!.extractedDate || '2026-08-16',
        totalAmount: doc!.extractedTotalAmount || 112000,
        reference: `OCR Source: ${doc!.fileName}`,
        notes: 'Posted from verified OCR source document'
      }, userId);

      expect(billId).toBeDefined();

      // Update document link
      await db.update(schema.documents).set({
        verificationStatus: 'POSTED_TO_ACCOUNTING',
        linkedTransactionType: 'PURCHASE_BILL',
        linkedTransactionId: billId,
        linkedVendorId: vendorId,
        updatedAt: new Date()
      }).where(eq(schema.documents.id, docId1));

      const postedDoc = await db.select().from(schema.documents).where(eq(schema.documents.id, docId1)).get();
      expect(postedDoc!.verificationStatus).toBe('POSTED_TO_ACCOUNTING');
      expect(postedDoc!.linkedTransactionType).toBe('PURCHASE_BILL');
      expect(postedDoc!.linkedTransactionId).toBe(billId);

      const bill = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, billId)).get();
      expect(bill!.totalAmount).toBe(112000);
      expect(bill!.status).toBe('DRAFT');
    });
  });

  it('6. should post verified document to Accounting as a Balanced Double-Entry Journal Voucher', async () => {
    await runInTestDb(async () => {
      // Insert Doc 2 for Journal Entry
      await db.insert(schema.documents).values({
        id: docId2,
        companyId,
        entityType: 'GENERAL',
        entityId: 'NONE',
        documentType: 'BANK_DOCUMENT',
        fileName: 'Bank_Charge_Advice.pdf',
        originalFileName: 'Bank_Charge_Advice.pdf',
        fileType: 'application/pdf',
        fileSize: 1024 * 30,
        filePath: '/tmp/bank_advice.pdf',
        source: 'WEB_UI',
        uploadedBy: userId,
        status: 'ACTIVE',
        ocrStatus: 'COMPLETED',
        verificationStatus: 'VERIFIED',
        extractedMerchant: 'BDO Unibank Inc.',
        extractedInvoiceNumber: 'BDO-CHG-5541',
        extractedDate: '2026-08-16',
        extractedTotalAmount: 50000, // ₱500.00
      });

      // Post Balanced Journal Entry (Debit Bank Charges Expense ₱500, Credit Cash in Bank ₱500)
      const journalId = await AccountingEngine.postBalancedJournalEntry(companyId, {
        journalNumber: 'JV-OCR-BDO-5541',
        entryDate: '2026-08-16',
        description: 'Bank Service Charges from OCR Evidence',
        sourceType: 'documents',
        sourceId: docId2,
        createdBy: userId
      }, [
        {
          accountId: defaultAccounts["6000"]?.id,
          debit: 50000,
          credit: 0,
          description: 'Bank Service Charges'
        },
        {
          accountId: defaultAccounts["1100"]?.id,
          debit: 0,
          credit: 50000,
          description: 'Cash in Bank'
        }
      ]);

      expect(journalId).toBeDefined();

      await db.update(schema.documents).set({
        verificationStatus: 'POSTED_TO_ACCOUNTING',
        linkedTransactionType: 'JOURNAL_ENTRY',
        linkedTransactionId: journalId,
        updatedAt: new Date()
      }).where(eq(schema.documents.id, docId2));

      const finalDoc = await db.select().from(schema.documents).where(eq(schema.documents.id, docId2)).get();
      expect(finalDoc!.verificationStatus).toBe('POSTED_TO_ACCOUNTING');
      expect(finalDoc!.linkedTransactionType).toBe('JOURNAL_ENTRY');
      expect(finalDoc!.linkedTransactionId).toBe(journalId);

      const journal = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(journal!.status).toBe('POSTED');
    });
  });
});
