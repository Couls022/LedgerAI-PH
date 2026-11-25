import type { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, or, like } from "drizzle-orm";
import { TaxEngine } from "./taxEngine";
import { createWorker } from "tesseract.js";
import { PDFParse } from "pdf-parse";

export type OcrExtractionEngine = 'TESSERACT_WASM' | 'AI_GEMINI' | 'HEURISTIC_FALLBACK';

export interface ExtractedDocumentItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxCode?: string;
  confidenceScore?: number;
  pageNumber?: number;
  needsReview?: boolean;
  reviewReason?: string;
}

export interface ExtractedDocumentData {
  documentType: string; // RECEIPT, SALES_INVOICE, PURCHASE_INVOICE, OFFICIAL_RECEIPT, BILLING_STATEMENT, BANK_DOCUMENT, BIR_DOCUMENT, TAX_FORM, CONTRACT, GENERAL_ATTACHMENT
  merchant: string;
  customer: string;
  tin: string;
  address: string;
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  paymentMethod: string;
  category: string;
  items: ExtractedDocumentItem[];
  subtotal: number;
  discount: number;
  vatableSales: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  vatAmount: number;
  withholdingTax: number;
  totalAmount: number;
  confidenceScore: number;
  summary: string;
  rawText?: string;
  extractionEngine: OcrExtractionEngine;
  pageCount?: number;
  needsReview?: boolean;
  reviewReasons?: string[];
}

export interface DocumentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  arithmeticMatches: boolean;
  tinValid: boolean;
  birCompliant: boolean;
  isDuplicate: boolean;
  duplicateDocumentId?: string;
  duplicateReason?: string;
  matchedVendorId?: string;
  matchedVendorName?: string;
  matchedCustomerId?: string;
  matchedCustomerName?: string;
  suggestedAction: 'CREATE_PURCHASE_BILL' | 'CREATE_SALES_INVOICE' | 'CREATE_EXPENSE' | 'CREATE_JOURNAL_ENTRY' | 'ATTACH_ONLY';
}

export class OCRService {
  /**
   * Calculates SHA-256 checksum of a file buffer or base64 string
   */
  static calculateFileHash(bufferOrBase64: Buffer | string): string {
    const hash = crypto.createHash('sha256');
    if (typeof bufferOrBase64 === 'string') {
      const clean = bufferOrBase64.replace(/^data:.*?;base64,/, '');
      hash.update(Buffer.from(clean, 'base64'));
    } else {
      hash.update(bufferOrBase64);
    }
    return hash.digest('hex');
  }

  /**
   * Cleans and normalizes Philippine Tax Identification Number (TIN)
   */
  static normalizeTin(rawTin: string | null | undefined): string {
    if (!rawTin) return '';
    // Strip everything except digits
    const digits = rawTin.replace(/\D/g, '');
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-000`;
    }
    if (digits.length >= 12) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9, 12)}`;
    }
    if (digits.length > 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`;
    }
    return rawTin.trim();
  }

  /**
   * Normalizes date string into YYYY-MM-DD standard format
   */
  static normalizeDate(rawDate: string | null | undefined): string {
    if (!rawDate) return new Date().toISOString().split('T')[0];
    const cleaned = rawDate.trim();
    
    // Check if already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return cleaned;
    }
    
    // Parse common Philippine & US formats like MM/DD/YYYY or DD-MM-YYYY
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    
    // Fallback regex for MM/DD/YYYY
    const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slashMatch) {
      let [_, p1, p2, p3] = slashMatch;
      if (p3.length === 2) p3 = '20' + p3;
      // Assume MM/DD/YYYY
      const m = parseInt(p1, 10);
      const d = parseInt(p2, 10);
      if (m <= 12) {
        return `${p3}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    return new Date().toISOString().split('T')[0];
  }

  /**
   * Parse numerical amounts cleanly
   */
  static normalizeAmount(val: any): number {
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val * 100) / 100;
    if (typeof val === 'string') {
      const clean = val.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    }
    return 0;
  }

  /**
   * Automatically infer document type from extracted text and characteristics
   */
  static inferDocumentType(data: Partial<ExtractedDocumentData>): string {
    const text = `${data.merchant || ''} ${data.summary || ''} ${data.invoiceNumber || ''} ${data.category || ''}`.toLowerCase();
    
    if (text.includes('official receipt') || text.includes('bir or') || text.includes('o.r.')) {
      return 'OFFICIAL_RECEIPT';
    }
    if (text.includes('sales invoice') || text.includes('billing invoice')) {
      return 'SALES_INVOICE';
    }
    if (text.includes('statement of account') || text.includes('soa') || text.includes('billing statement')) {
      return 'BILLING_STATEMENT';
    }
    if (text.includes('bir form') || text.includes('2307') || text.includes('certificate of creditable tax')) {
      return 'TAX_FORM';
    }
    if (text.includes('bank statement') || text.includes('deposit slip') || text.includes('check voucher')) {
      return 'BANK_DOCUMENT';
    }
    if (text.includes('purchase order') || text.includes('purchase invoice') || text.includes('vendor bill')) {
      return 'PURCHASE_INVOICE';
    }
    if (text.includes('receipt') || text.includes('pos') || text.includes('cash slip')) {
      return 'RECEIPT';
    }
    return data.documentType || 'RECEIPT';
  }

  /**
   * Parse plain text string into structured ExtractedDocumentData
   */
  static parsePlainText(rawText: string, defaultEngine: OcrExtractionEngine = 'TESSERACT_WASM', pageCount: number = 1): ExtractedDocumentData {
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const today = new Date().toISOString().split('T')[0];

    let merchant = "Philippine Commercial Entity";
    let tin = "";
    let invoiceNumber = "";
    let date = today;
    let totalAmount = 0;
    let vatAmount = 0;
    let subtotal = 0;

    // Search for TIN
    for (const line of lines) {
      const tinMatch = line.match(/(?:TIN|VAT\s*REG|TAX\s*ID)[:\s#]*([0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3}(?:[-\s]?[0-9]{3,5})?)/i);
      if (tinMatch) {
        tin = this.normalizeTin(tinMatch[1]);
        break;
      }
    }

    // Search for Invoice / Receipt Number
    for (const line of lines) {
      const invMatch = line.match(/(?:INV|INVOICE|OR|O\.R\.|RECEIPT|BILL|DOC|REF|SI|S\.I\.)[:\s#.-]*([A-Z0-9-]{3,})/i);
      if (invMatch) {
        invoiceNumber = invMatch[1].trim();
        break;
      }
    }

    // Search for Date
    for (const line of lines) {
      const dateMatch = line.match(/(?:DATE)[:\s]*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i);
      if (dateMatch) {
        date = this.normalizeDate(dateMatch[1]);
        break;
      }
    }

    // Search for Merchant (first line with letters)
    for (const line of lines) {
      if (line.length > 3 && !line.match(/^(?:TIN|INV|DATE|TOTAL|PHP|PAGE|\d+)/i)) {
        merchant = line.replace(/^[#*-]\s*/, '').trim();
        break;
      }
    }

    // Search for Amounts
    for (const line of lines) {
      const totalMatch = line.match(/(?:TOTAL|AMOUNT\s*DUE|GRAND\s*TOTAL)[:\s=PHP₱]*([0-9,]+\.[0-9]{2})/i);
      if (totalMatch) {
        totalAmount = this.normalizeAmount(totalMatch[1]);
      }
      const vatMatch = line.match(/(?:VAT|12%\s*VAT|VALUE\s*ADDED\s*TAX)[:\s=PHP₱]*([0-9,]+\.[0-9]{2})/i);
      if (vatMatch) {
        vatAmount = this.normalizeAmount(vatMatch[1]);
      }
      const subtotalMatch = line.match(/(?:SUBTOTAL|NET\s*AMOUNT|VATABLE)[:\s=PHP₱]*([0-9,]+\.[0-9]{2})/i);
      if (subtotalMatch) {
        subtotal = this.normalizeAmount(subtotalMatch[1]);
      }
    }

    // Extract Line Items
    const items: ExtractedDocumentItem[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const itemMatch = line.match(/(?:Item\s*\d*[:\s-]*|Line\s*\d*[:\s-]*|^)(.*?)\s*[-:]*\s*(?:PHP|₱)?\s*([0-9,]+\.[0-9]{2})$/i);
      if (itemMatch && !line.match(/(?:TOTAL|SUBTOTAL|VAT|TAX|CHANGE|CASH)/i)) {
        const itemDesc = itemMatch[1].trim();
        const itemAmt = this.normalizeAmount(itemMatch[2]);
        if (itemAmt > 0 && itemDesc.length > 2) {
          items.push({
            description: itemDesc,
            quantity: 1,
            unitPrice: itemAmt,
            amount: itemAmt,
            taxCode: vatAmount > 0 ? "VAT_12" : "VAT_EXEMPT",
            confidenceScore: 0.90,
            pageNumber: 1,
            needsReview: false
          });
        }
      }
    }

    if (totalAmount === 0 && items.length > 0) {
      subtotal = items.reduce((s, it) => s + it.amount, 0);
      vatAmount = Math.round(subtotal * 0.12 * 100) / 100;
      totalAmount = Math.round((subtotal + vatAmount) * 100) / 100;
    } else if (subtotal === 0 && totalAmount > 0) {
      if (vatAmount > 0) {
        subtotal = Math.round((totalAmount - vatAmount) * 100) / 100;
      } else {
        const split = TaxEngine.calculateVat(Math.round(totalAmount * 100), 0.12);
        subtotal = split.taxBase / 100;
        vatAmount = split.vatAmount / 100;
      }
    }

    const hasExtractedAmounts = totalAmount > 0 || subtotal > 0 || items.length > 0;
    const reviewReasons: string[] = [];
    if (!tin) {
      reviewReasons.push('MANUAL_REVIEW_REQUIRED: Supplier/Issuer TIN was not detected in document text.');
    }
    if (!invoiceNumber) {
      reviewReasons.push('MANUAL_REVIEW_REQUIRED: Official Receipt / Invoice serial number was not detected.');
    }
    if (!hasExtractedAmounts) {
      reviewReasons.push('MANUAL_REVIEW_REQUIRED: Financial amounts could not be reliably extracted; manual entry required.');
    }

    if (items.length === 0) {
      items.push({
        description: hasExtractedAmounts
          ? `${merchant} - Extracted Line`
          : 'Unverified OCR Line Item (Manual Review Required)',
        quantity: 1,
        unitPrice: subtotal || totalAmount || 0,
        amount: subtotal || totalAmount || 0,
        taxCode: vatAmount > 0 ? "VAT_12" : "VAT_EXEMPT",
        confidenceScore: hasExtractedAmounts ? 0.90 : 0,
        pageNumber: 1,
        needsReview: !hasExtractedAmounts,
        reviewReason: !hasExtractedAmounts ? 'No line items recognized; manual entry required' : undefined
      });
    }

    const computedSubtotal = subtotal || (totalAmount > 0 ? Math.max(0, Math.round((totalAmount - vatAmount) * 100) / 100) : 0);
    const needsReview = !hasExtractedAmounts || !tin || !invoiceNumber;

    return {
      documentType: 'RECEIPT',
      merchant: hasExtractedAmounts || lines.length > 0 ? merchant : 'UNVERIFIED_DOCUMENT',
      customer: '',
      tin: tin || '',
      address: '',
      invoiceNumber: invoiceNumber || '',
      date,
      paymentMethod: 'UNSPECIFIED',
      category: 'Uncategorized',
      items,
      subtotal: computedSubtotal,
      discount: 0,
      vatableSales: vatAmount > 0 ? computedSubtotal : 0,
      vatExemptSales: vatAmount === 0 ? computedSubtotal : 0,
      zeroRatedSales: 0,
      vatAmount: vatAmount || 0,
      withholdingTax: 0,
      totalAmount: totalAmount || 0,
      confidenceScore: hasExtractedAmounts ? 0.90 : 0,
      summary: invoiceNumber ? `${merchant} - ${invoiceNumber}` : `${merchant} (Manual Review Required)`,
      rawText,
      extractionEngine: defaultEngine,
      pageCount,
      needsReview,
      reviewReasons
    };
  }

  /**
   * Real offline Tesseract WASM OCR execution using local traineddata
   */
  static async executeTesseractWasm(imageBuffer: Buffer): Promise<ExtractedDocumentData> {
    // Verify structural completeness of PNG (IHDR + IEND) or JPEG (FFD8...FFD9) before passing to Leptonica WASM worker
    const isCompletePng =
      imageBuffer.length >= 57 &&
      imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47 &&
      imageBuffer.subarray(12, 16).toString('ascii') === 'IHDR' &&
      imageBuffer.includes(Buffer.from('IEND'));
    const isCompleteJpeg =
      imageBuffer.length >= 20 &&
      imageBuffer[0] === 0xff &&
      imageBuffer[1] === 0xd8 &&
      imageBuffer[2] === 0xff &&
      imageBuffer[imageBuffer.length - 2] === 0xff &&
      imageBuffer[imageBuffer.length - 1] === 0xd9;

    if (!isCompletePng && !isCompleteJpeg) {
      const printableText = imageBuffer
        .toString('utf8')
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
        .trim();
      const parsed = this.parsePlainText(printableText, 'TESSERACT_WASM', 1);
      parsed.extractionEngine = 'TESSERACT_WASM';
      return parsed;
    }

    const candidateLangPaths = [
      path.resolve(process.cwd(), 'resources/ocr/traineddata'),
      (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'ocr', 'traineddata') : '',
      path.resolve(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '../../resources/ocr/traineddata'),
      path.resolve(typeof __dirname !== 'undefined' ? __dirname : process.cwd(), '../resources/ocr/traineddata')
    ].filter(Boolean);
    const langPath = candidateLangPaths.find((p) => fs.existsSync(p)) || candidateLangPaths[0];
    let worker: any = null;

    try {
      worker = await createWorker('eng', 1, {
        langPath,
        cacheMethod: 'none',
        gzip: false,
        errorHandler: () => {}
      });

      const ret = await worker.recognize(imageBuffer, {}, {
        text: true,
        tsv: true,
        blocks: true
      });

      const rawText = ret.data.text || '';
      const docConfidence = typeof ret.data.confidence === 'number' ? (ret.data.confidence / 100) : 0.88;

      // Parse TSV for per-line confidences
      const lineConfidences: Map<number, { text: string; conf: number }> = new Map();
      if (ret.data.tsv) {
        const tsvLines = ret.data.tsv.split('\n');
        for (let i = 1; i < tsvLines.length; i++) {
          const cols = tsvLines[i].split('\t');
          if (cols.length >= 12 && cols[0] === '5') { // word level
            const lineNum = parseInt(cols[4], 10) || 0;
            const wordConf = parseFloat(cols[10]) || 0;
            const wordText = cols[11]?.trim() || '';
            const existing = lineConfidences.get(lineNum);
            if (existing) {
              existing.conf = (existing.conf + (wordConf / 100)) / 2;
              existing.text += ' ' + wordText;
            } else {
              lineConfidences.set(lineNum, { text: wordText, conf: wordConf / 100 });
            }
          }
        }
      }

      const parsed = this.parsePlainText(rawText, 'TESSERACT_WASM', 1);
      parsed.confidenceScore = docConfidence;

      // Attach line confidences & flag lines < 0.85
      const reviewReasons: string[] = [];
      let docNeedsReview = docConfidence < 0.85;
      if (docNeedsReview) {
        reviewReasons.push(`Overall document optical recognition confidence (${(docConfidence * 100).toFixed(1)}%) is below the 0.85 threshold.`);
      }

      parsed.items = parsed.items.map((it, idx) => {
        const lineConf = lineConfidences.get(idx + 1)?.conf ?? docConfidence;
        const needsReview = lineConf < 0.85;
        if (needsReview) {
          docNeedsReview = true;
          reviewReasons.push(`Line item #${idx + 1} ('${it.description}') confidence (${(lineConf * 100).toFixed(1)}%) requires human review.`);
        }
        return {
          ...it,
          confidenceScore: lineConf,
          needsReview,
          reviewReason: needsReview ? 'Optical character confidence below 0.85 threshold' : undefined
        };
      });

      parsed.needsReview = docNeedsReview;
      parsed.reviewReasons = reviewReasons;
      parsed.extractionEngine = 'TESSERACT_WASM';
      return parsed;
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
    }
  }

  /**
   * Multi-Page PDF line item extraction and page iteration
   */
  static async parsePdfMultiPage(pdfBuffer: Buffer): Promise<ExtractedDocumentData> {
    try {
      const parser = new PDFParse({ data: pdfBuffer });
      await (parser as any).load();
      const textResult = await parser.getText();
      const totalPages = textResult.total || (textResult.pages ? textResult.pages.length : 1);

      let allText = '';
      const aggregatedItems: ExtractedDocumentItem[] = [];
      const reviewReasons: string[] = [];

      for (let pageIdx = 0; pageIdx < (textResult.pages || []).length; pageIdx++) {
        const page = textResult.pages[pageIdx];
        const pageNum = page.num || (pageIdx + 1);
        const pageText = page.text || '';
        allText += `\n--- PAGE ${pageNum} ---\n` + pageText;

        const pageLines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (const line of pageLines) {
          const itemMatch = line.match(/(?:Item\s*\d*[:\s-]*|Line\s*\d*[:\s-]*|^)(.*?)\s*[-:]*\s*(?:PHP|₱)?\s*([0-9,]+\.[0-9]{2})$/i);
          if (itemMatch && !line.match(/(?:TOTAL|SUBTOTAL|VAT|TAX|CHANGE|CASH|PAGE)/i)) {
            const desc = itemMatch[1].trim();
            const amt = this.normalizeAmount(itemMatch[2]);
            if (amt > 0 && desc.length > 2) {
              aggregatedItems.push({
                description: `Page ${pageNum}: ${desc}`,
                quantity: 1,
                unitPrice: amt,
                amount: amt,
                taxCode: 'VAT_12',
                confidenceScore: 0.95,
                pageNumber: pageNum,
                needsReview: false
              });
            }
          }
        }
      }

      const parsed = this.parsePlainText(allText.length > 0 ? allText : textResult.text, 'TESSERACT_WASM', totalPages);
      if (aggregatedItems.length > 0) {
        parsed.items = aggregatedItems;
        parsed.subtotal = aggregatedItems.reduce((s, it) => s + it.amount, 0);
        parsed.vatAmount = Math.round(parsed.subtotal * 0.12 * 100) / 100;
        parsed.totalAmount = Math.round((parsed.subtotal + parsed.vatAmount) * 100) / 100;
        parsed.vatableSales = parsed.subtotal;
      }
      parsed.pageCount = totalPages;
      parsed.extractionEngine = 'TESSERACT_WASM';
      return parsed;
    } catch (pdfErr: any) {
      // If not a valid binary PDF, try parsing as raw text if it contains readable characters
      const asString = pdfBuffer.toString('utf8');
      if (asString.includes('Receipt') || asString.includes('Invoice') || asString.includes('Total') || asString.includes('PHP')) {
        return this.parsePlainText(asString, 'TESSERACT_WASM', 1);
      }
      throw pdfErr;
    }
  }

  /**
   * Main OCR processor using Gemini or offline Tesseract WASM / PDF-parse
   */
  static async parseReceipt(
    input: string | Buffer,
    mimeType: string = "image/jpeg",
    options?: { forceEngine?: OcrExtractionEngine }
  ): Promise<ExtractedDocumentData> {
    let rawBuffer: Buffer;
    if (typeof input === 'string') {
      const cleanBase64 = input.replace(/^data:image\/\w+;base64,/, "").replace(/^data:application\/pdf;base64,/, "");
      rawBuffer = Buffer.from(cleanBase64, 'base64');
    } else {
      rawBuffer = input;
    }

    const isPdf = mimeType === 'application/pdf' || rawBuffer.slice(0, 5).toString() === '%PDF-';

    // Route 1: PDF Multi-page processing
    if (isPdf) {
      try {
        return await this.parsePdfMultiPage(rawBuffer);
      } catch (pdfError: any) {
        console.warn("[OCRService] PDF parse failed, attempting fallback:", pdfError?.message);
      }
    }

    // Route 2: Gemini API if key is present and not explicitly forced to WASM
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && options?.forceEngine !== 'TESSERACT_WASM') {
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            }
          }
        });

        const promptText = `You are an expert Philippine tax accountant and optical character recognition (OCR) auditor for BIR (Bureau of Internal Revenue) compliance.
Analyze this receipt, sales invoice, official receipt (OR), or billing statement image. Extract all accounting and tax fields with high precision.

Return ONLY a valid JSON object matching this schema:
{
  "documentType": "RECEIPT | SALES_INVOICE | PURCHASE_INVOICE | OFFICIAL_RECEIPT | BILLING_STATEMENT | BANK_DOCUMENT | BIR_DOCUMENT | TAX_FORM | CONTRACT | GENERAL_ATTACHMENT",
  "merchant": "Registered Business Name / Seller Legal Name",
  "customer": "Buyer Name / Client Name if shown",
  "tin": "Seller Tax Identification Number (TIN) in XXX-XXX-XXX-XXX format",
  "address": "Registered business address",
  "invoiceNumber": "Invoice or Official Receipt / Serial Number",
  "date": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "paymentMethod": "CASH | CHECK | BANK_TRANSFER | CREDIT_CARD | GCASH | MAYA | OTHER",
  "category": "Office Supplies | Utilities | Travel & Transport | Meals & Entertainment | Professional Services | Hardware & Equipment | Rent & Facilities | Cost of Goods Sold | Communication | Miscellaneous",
  "items": [
    {
      "description": "Item or service description",
      "quantity": 1,
      "unitPrice": 0.00,
      "amount": 0.00,
      "taxCode": "VAT_12 | VAT_EXEMPT | ZERO_RATED"
    }
  ],
  "subtotal": 0.00,
  "discount": 0.00,
  "vatableSales": 0.00,
  "vatExemptSales": 0.00,
  "zeroRatedSales": 0.00,
  "vatAmount": 0.00,
  "withholdingTax": 0.00,
  "totalAmount": 0.00,
  "confidenceScore": 0.95,
  "summary": "1-sentence concise description of the document"
}`;

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              inlineData: {
                mimeType,
                data: rawBuffer.toString('base64'),
              }
            },
            {
              text: promptText
            }
          ],
          config: {
            responseMimeType: "application/json",
          }
        });

        if (response.text) {
          const parsed = JSON.parse(response.text);
          const normalized = this.normalizeExtractedData(parsed);
          normalized.extractionEngine = 'AI_GEMINI';
          return normalized;
        }
      } catch (geminiError: any) {
        console.warn("[OCRService] Gemini parsing error, falling back to local Tesseract WASM:", geminiError?.message);
      }
    }

    // Route 3: Real Offline Tesseract WASM execution
    try {
      return await this.executeTesseractWasm(rawBuffer);
    } catch (tesseractError: any) {
      console.warn("[OCRService] Tesseract WASM extraction error, using heuristic fallback:", tesseractError?.message);
    }

    // Route 4: Heuristic fallback (explicitly tagged HEURISTIC_FALLBACK)
    return this.fallbackHeuristicParser(rawBuffer.toString('base64'));
  }

  /**
   * Normalizes raw extracted JSON data
   */
  static normalizeExtractedData(raw: any): ExtractedDocumentData {
    const merchant = (raw.merchant || raw.vendorName || raw.vendor || "Unknown Merchant").trim();
    const customer = (raw.customer || raw.customerName || raw.buyer || "").trim();
    const tin = this.normalizeTin(raw.tin || raw.taxId || raw.sellerTin || "");
    const address = (raw.address || "").trim();
    const invoiceNumber = (raw.invoiceNumber || raw.receiptNumber || raw.orNumber || raw.referenceNumber || "").trim();
    const rawDateInput = raw.date !== undefined ? raw.date : (raw.invoiceDate !== undefined ? raw.invoiceDate : raw.receiptDate);
    const date = (rawDateInput === undefined || rawDateInput === null || String(rawDateInput).trim() === '')
      ? ''
      : this.normalizeDate(String(rawDateInput));
    const dueDate = raw.dueDate ? this.normalizeDate(raw.dueDate) : undefined;
    const paymentMethod = (raw.paymentMethod || "CASH").toUpperCase();
    const category = (raw.category || "Office Supplies").trim();
    const summary = raw.summary || `${merchant} - ${invoiceNumber || 'Receipt'}`;

    const totalAmount = this.normalizeAmount(raw.totalAmount || raw.amount || 0);
    const vatAmount = this.normalizeAmount(raw.vatAmount || raw.vat || 0);
    const subtotal = this.normalizeAmount(raw.subtotal || (totalAmount > 0 ? totalAmount - vatAmount : 0));
    const discount = this.normalizeAmount(raw.discount || 0);
    const vatableSales = this.normalizeAmount(raw.vatableSales || (vatAmount > 0 ? Math.round((vatAmount / 0.12) * 100) / 100 : subtotal));
    const vatExemptSales = this.normalizeAmount(raw.vatExemptSales || 0);
    const zeroRatedSales = this.normalizeAmount(raw.zeroRatedSales || 0);
    const withholdingTax = this.normalizeAmount(raw.withholdingTax || 0);
    const overallConf = typeof raw.confidenceScore === 'number' ? raw.confidenceScore : 0.90;

    const reviewReasons: string[] = [];
    let docNeedsReview = overallConf < 0.85;
    if (docNeedsReview) {
      reviewReasons.push(`Confidence score (${(overallConf * 100).toFixed(1)}%) is below the 0.85 threshold.`);
    }

    let items: ExtractedDocumentItem[] = [];
    if (Array.isArray(raw.items) && raw.items.length > 0) {
      items = raw.items.map((it: any, idx: number) => {
        const itemConf = typeof it.confidenceScore === 'number' ? it.confidenceScore : overallConf;
        const needsReview = it.needsReview || itemConf < 0.85;
        if (needsReview) {
          docNeedsReview = true;
          reviewReasons.push(`Line item #${idx + 1} (${it.description || 'Item'}) requires review.`);
        }
        return {
          description: (it.description || it.name || "Item").trim(),
          quantity: Math.max(1, typeof it.quantity === 'number' ? it.quantity : 1),
          unitPrice: this.normalizeAmount(it.unitPrice || it.price || it.amount || 0),
          amount: this.normalizeAmount(it.amount || ((it.quantity || 1) * (it.unitPrice || 0))),
          taxCode: it.taxCode || (vatAmount > 0 ? "VAT_12" : "VAT_EXEMPT"),
          confidenceScore: itemConf,
          pageNumber: it.pageNumber || 1,
          needsReview,
          reviewReason: it.reviewReason || (needsReview ? 'Confidence below 0.85' : undefined)
        };
      });
    } else {
      items = [{
        description: summary || "Goods / Services",
        quantity: 1,
        unitPrice: subtotal || totalAmount,
        amount: subtotal || totalAmount,
        taxCode: vatAmount > 0 ? "VAT_12" : "VAT_EXEMPT",
        confidenceScore: overallConf,
        pageNumber: 1,
        needsReview: docNeedsReview
      }];
    }

    const data: ExtractedDocumentData = {
      documentType: raw.documentType || 'RECEIPT',
      merchant,
      customer,
      tin,
      address,
      invoiceNumber,
      date,
      dueDate,
      paymentMethod,
      category,
      items,
      subtotal,
      discount,
      vatableSales,
      vatExemptSales,
      zeroRatedSales,
      vatAmount,
      withholdingTax,
      totalAmount,
      confidenceScore: overallConf,
      summary,
      extractionEngine: raw.extractionEngine || 'TESSERACT_WASM',
      pageCount: raw.pageCount || 1,
      needsReview: docNeedsReview,
      reviewReasons
    };

    data.documentType = this.inferDocumentType(data);
    return data;
  }

  /**
   * Offline heuristic parser for synthetic test cases (explicitly tagged HEURISTIC_FALLBACK)
   */
  private static fallbackHeuristicParser(_cleanBase64: string): ExtractedDocumentData {
    const today = new Date().toISOString().split('T')[0];
    return {
      documentType: "RECEIPT",
      merchant: "UNVERIFIED_DOCUMENT",
      customer: "",
      tin: "",
      address: "",
      invoiceNumber: "",
      date: today,
      paymentMethod: "UNSPECIFIED",
      category: "Uncategorized",
      items: [
        {
          description: "Unverified OCR Line Item (Manual Review Required)",
          quantity: 1,
          unitPrice: 0.00,
          amount: 0.00,
          taxCode: "VAT_EXEMPT",
          confidenceScore: 0,
          pageNumber: 1,
          needsReview: true,
          reviewReason: "Optical recognition failed; manual data entry required."
        }
      ],
      subtotal: 0.00,
      discount: 0.00,
      vatableSales: 0.00,
      vatExemptSales: 0.00,
      zeroRatedSales: 0.00,
      vatAmount: 0.00,
      withholdingTax: 0.00,
      totalAmount: 0.00,
      confidenceScore: 0,
      summary: "MANUAL_REVIEW_REQUIRED: Optical extraction unavailable; human verification required before posting.",
      extractionEngine: 'HEURISTIC_FALLBACK',
      pageCount: 1,
      needsReview: true,
      reviewReasons: [
        "MANUAL_REVIEW_REQUIRED: Optical character recognition could not extract verified fields from this document."
      ]
    };
  }

  /**
   * Comprehensive validation engine checking arithmetic consistency, BIR compliance, and duplicates
   */
  static async validateExtractedData(
    companyId: string,
    data: ExtractedDocumentData,
    fileHash?: string,
    currentDocId?: string
  ): Promise<DocumentValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Arithmetic Consistency Verification
    let arithmeticMatches = true;
    const computedExpectedTotal = Math.round((data.subtotal - data.discount + data.vatAmount) * 100) / 100;
    const diffTotal = Math.abs(computedExpectedTotal - data.totalAmount);
    if (diffTotal > 0.05 && data.totalAmount > 0) {
      warnings.push(`Arithmetic variance: Subtotal (${data.subtotal.toFixed(2)}) - Discount (${data.discount.toFixed(2)}) + VAT (${data.vatAmount.toFixed(2)}) = ${computedExpectedTotal.toFixed(2)}, which differs from Total (${data.totalAmount.toFixed(2)}).`);
      arithmeticMatches = false;
    }

    // Statutory Philippine VAT Rate Check using TaxEngine
    if (data.vatableSales > 0 && data.vatAmount > 0) {
      const vatableCentavos = Math.round(data.vatableSales * 100);
      const expectedVatCentavos = TaxEngine.calculatePercentage(vatableCentavos, 0.12);
      const expectedVat = expectedVatCentavos / 100;
      const vatDiff = Math.abs(expectedVat - data.vatAmount);
      if (vatDiff > 0.10) {
        warnings.push(`Statutory VAT calculation check (TaxEngine): 12% of VATable sales (${data.vatableSales.toFixed(2)}) is ${expectedVat.toFixed(2)}, but extracted VAT is ${data.vatAmount.toFixed(2)}.`);
      }
    } else if (data.totalAmount > 0 && data.vatAmount > 0) {
      const grossCentavos = Math.round(data.totalAmount * 100);
      const { vatAmount: statutoryVatCentavos } = TaxEngine.calculateVat(grossCentavos, 0.12);
      const statutoryVat = statutoryVatCentavos / 100;
      const vatDiff = Math.abs(statutoryVat - data.vatAmount);
      if (vatDiff > 0.15) {
        warnings.push(`Statutory 12/112 VAT extraction check (TaxEngine): Expected ₱${statutoryVat.toFixed(2)} from gross ₱${data.totalAmount.toFixed(2)}, but extracted VAT is ₱${data.vatAmount.toFixed(2)}.`);
      }
    }

    // Line Items Sum Check
    if (data.items && data.items.length > 0) {
      const itemsSum = data.items.reduce((sum, it) => sum + (it.amount || 0), 0);
      const diffItems = Math.abs(itemsSum - (data.subtotal || data.totalAmount));
      if (diffItems > 0.10 && itemsSum > 0) {
        warnings.push(`Line items sum (${itemsSum.toFixed(2)}) differs from subtotal (${(data.subtotal || data.totalAmount).toFixed(2)}).`);
        arithmeticMatches = false;
      }
    }

    // Mandatory Human Review Check for Low-Confidence Items (< 0.85)
    const lowConfItems = (data.items || []).filter(it => it.needsReview || (typeof it.confidenceScore === 'number' && it.confidenceScore < 0.85));
    if (lowConfItems.length > 0 || (typeof data.confidenceScore === 'number' && data.confidenceScore < 0.85)) {
      warnings.push(`Mandatory human review required: ${lowConfItems.length > 0 ? `${lowConfItems.length} line item(s)` : 'Document'} flagged with optical confidence below the 0.85 threshold.`);
    }

    // 2. BIR Invoicing Compliance Checks (RR 16-2005 & EOPT Act)
    let birCompliant = true;
    let tinValid = false;

    if (!data.merchant || data.merchant.trim() === '' || data.merchant.toLowerCase() === 'unknown merchant') {
      errors.push("Merchant / Registered Business name is missing.");
      birCompliant = false;
    }

    if (data.tin) {
      const cleanDigits = data.tin.replace(/\D/g, '');
      if (cleanDigits.length >= 9 && cleanDigits.length <= 12) {
        tinValid = true;
      } else {
        warnings.push(`TIN format '${data.tin}' does not match standard 9-12 digit Philippine TIN format.`);
      }
    } else {
      warnings.push("Merchant TIN is missing. Input VAT may be disallowed under BIR regulations without seller TIN.");
      birCompliant = false;
    }

    if (!data.invoiceNumber || data.invoiceNumber.trim() === '') {
      warnings.push("Invoice / Official Receipt number is missing.");
      birCompliant = false;
    }

    if (!data.date) {
      errors.push("Transaction date is missing.");
      birCompliant = false;
    }

    if (data.totalAmount <= 0) {
      errors.push("Document total amount must be greater than zero.");
    }

    // 3. Duplicate Document & Hash Detection
    let isDuplicate = false;
    let duplicateDocumentId: string | undefined = undefined;
    let duplicateReason: string | undefined = undefined;

    // A. Check by SHA-256 file hash
    if (fileHash) {
      const existingHashDoc = await db.select({
        id: schema.documents.id,
        fileName: schema.documents.fileName,
        createdAt: schema.documents.createdAt
      })
      .from(schema.documents)
      .where(and(
        eq(schema.documents.companyId, companyId),
        eq(schema.documents.fileHash, fileHash),
        eq(schema.documents.status, 'ACTIVE')
      ))
      .get();

      if (existingHashDoc && (!currentDocId || existingHashDoc.id !== currentDocId)) {
        isDuplicate = true;
        duplicateDocumentId = existingHashDoc.id;
        duplicateReason = `Exact duplicate file content matches existing document '${existingHashDoc.fileName}' (ID: ${existingHashDoc.id}).`;
        warnings.push(duplicateReason);
      }
    }

    // B. Check by Merchant TIN + Invoice Number + Date + Total
    if (!isDuplicate && data.tin && data.invoiceNumber && data.totalAmount > 0) {
      const totalCentavos = Math.round(data.totalAmount * 100);
      const existingTxDoc = await db.select({
        id: schema.documents.id,
        fileName: schema.documents.fileName,
        invoiceNumber: schema.documents.extractedInvoiceNumber
      })
      .from(schema.documents)
      .where(and(
        eq(schema.documents.companyId, companyId),
        eq(schema.documents.extractedInvoiceNumber, data.invoiceNumber),
        eq(schema.documents.extractedTotalAmount, totalCentavos),
        eq(schema.documents.status, 'ACTIVE')
      ))
      .get();

      if (existingTxDoc && (!currentDocId || existingTxDoc.id !== currentDocId)) {
        isDuplicate = true;
        duplicateDocumentId = existingTxDoc.id;
        duplicateReason = `Potential duplicate invoice: An existing document '${existingTxDoc.fileName}' already has Invoice #${data.invoiceNumber} with amount ₱${data.totalAmount.toFixed(2)}.`;
        warnings.push(duplicateReason);
      }
    }

    // 4. Master Data Matching (Vendors / Customers)
    let matchedVendorId: string | undefined = undefined;
    let matchedVendorName: string | undefined = undefined;
    let matchedCustomerId: string | undefined = undefined;
    let matchedCustomerName: string | undefined = undefined;

    // Look for matching vendor by TIN or Name
    if (data.tin || data.merchant) {
      const vendorConditions = [];
      if (data.tin) {
        vendorConditions.push(eq(schema.vendors.tin, data.tin));
      }
      if (data.merchant) {
        vendorConditions.push(like(schema.vendors.legalName, `%${data.merchant}%`));
      }

      const matchedVendor = await db.select()
        .from(schema.vendors)
        .where(and(
          eq(schema.vendors.companyId, companyId),
          or(...vendorConditions)
        ))
        .limit(1)
        .get();

      if (matchedVendor) {
        matchedVendorId = matchedVendor.id;
        matchedVendorName = matchedVendor.legalName;
      }
    }

    // Look for matching customer by TIN or Name
    if (data.tin || data.customer) {
      const customerConditions = [];
      if (data.tin) {
        customerConditions.push(eq(schema.customers.tin, data.tin));
      }
      if (data.customer) {
        customerConditions.push(like(schema.customers.legalName, `%${data.customer}%`));
      }

      const matchedCustomer = await db.select()
        .from(schema.customers)
        .where(and(
          eq(schema.customers.companyId, companyId),
          or(...customerConditions)
        ))
        .limit(1)
        .get();

      if (matchedCustomer) {
        matchedCustomerId = matchedCustomer.id;
        matchedCustomerName = matchedCustomer.legalName;
      }
    }

    // 5. Suggest Action based on Document Type
    let suggestedAction: DocumentValidationResult['suggestedAction'] = 'CREATE_PURCHASE_BILL';
    if (data.documentType === 'SALES_INVOICE') {
      suggestedAction = 'CREATE_SALES_INVOICE';
    } else if (data.documentType === 'RECEIPT' || data.documentType === 'OFFICIAL_RECEIPT') {
      suggestedAction = data.paymentMethod === 'CASH' ? 'CREATE_EXPENSE' : 'CREATE_PURCHASE_BILL';
    } else if (data.documentType === 'BANK_DOCUMENT' || data.documentType === 'TAX_FORM') {
      suggestedAction = 'CREATE_JOURNAL_ENTRY';
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings,
      arithmeticMatches,
      tinValid,
      birCompliant,
      isDuplicate,
      duplicateDocumentId,
      duplicateReason,
      matchedVendorId,
      matchedVendorName,
      matchedCustomerId,
      matchedCustomerName,
      suggestedAction,
    };
  }
}
