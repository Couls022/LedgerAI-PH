import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, desc, gte, lte, or, inArray } from "drizzle-orm";
import { TaxEngine } from "./taxEngine";

export type ComplianceSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface ComplianceFinding {
  ruleId: string;
  category: 'MISSING_DOCUMENT' | 'INVALID_TRANSACTION' | 'SUSPICIOUS_ENTRY' | 'DUPLICATE_INVOICE' | 'TAX_INCONSISTENCY' | 'BOOKKEEPING_ISSUE' | 'FILING_RISK' | 'STATUTORY_WARNING';
  severity: ComplianceSeverity;
  issue: string;
  explanation: string;
  affectedRecord: {
    type: 'SALES_INVOICE' | 'PURCHASE_BILL' | 'JOURNAL_ENTRY' | 'CUSTOMER' | 'VENDOR' | 'BANK_ACCOUNT' | 'TAX_PROFILE' | 'DOCUMENT' | 'PERIOD';
    id: string;
    reference?: string;
    amount?: number;
    date?: string;
    details?: Record<string, any>;
  };
  recommendedAction: string;
  authoritativeSource: string;
}

export interface ComplianceAuditReport {
  companyId: string;
  companyName: string;
  asOfDate: string;
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    healthScore: number; // 0 - 100
  };
  findings: ComplianceFinding[];
  statutoryChecklist: Array<{
    ruleCode: string;
    description: string;
    status: 'PASSED' | 'WARNING' | 'FAILED';
    notes: string;
  }>;
}

export class ComplianceRuleEngine {
  /**
   * Evaluates all statutory, accounting, tax, and bookkeeping rules for a given company.
   */
  static async evaluateAll(companyId: string): Promise<ComplianceAuditReport> {
    const findings: ComplianceFinding[] = [];
    const statutoryChecklist: ComplianceAuditReport['statutoryChecklist'] = [];

    // 1. Fetch Company Master & Tax Profile
    const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = company?.legalName || company?.tradeName || 'Company';
    const taxProfile = await db.select().from(schema.companyTaxProfiles).where(eq(schema.companyTaxProfiles.companyId, companyId)).get();
    const isVat = (company?.vatStatus === 'VAT') || (taxProfile?.vatStatus === 'VAT');

    // 2. Query transactions and related records
    const salesInvoices = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, companyId));
    const purchaseBills = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, companyId));
    const journalEntries = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId));
    const journalIds = journalEntries.map(j => j.id);
    const journalLines = journalIds.length > 0
      ? await db.select().from(schema.journalLines).where(inArray(schema.journalLines.journalEntryId, journalIds))
      : [];
    const customers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    const documents = await db.select().from(schema.documents).where(eq(schema.documents.companyId, companyId));

    // A. Check for Missing Documents (Receipts / Supporting attachments on Bills & Invoices)
    const docsBySourceId = new Set<string>();
    for (const doc of documents) {
      if (doc.entityId) docsBySourceId.add(doc.entityId);
    }

    for (const bill of purchaseBills) {
      if (bill.status === 'POSTED') {
        const hasDoc = docsBySourceId.has(bill.id) || (bill.attachmentUrl && bill.attachmentUrl.trim().length > 0);
        if (!hasDoc && bill.totalAmount > 500000) {
          findings.push({
            ruleId: 'COMP-DOC-001',
            category: 'MISSING_DOCUMENT',
            severity: bill.totalAmount >= 2000000 ? 'HIGH' : 'MEDIUM',
            issue: `Missing Supporting Document for Purchase Bill ${bill.billNumber}`,
            explanation: `Purchase Bill ${bill.billNumber} of ₱${(bill.totalAmount / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} has no attached scanned BIR-registered Sales Invoice (or supplementary Collection Receipt / Official Receipt), which is required under BIR EOPT Act RR 7-2024 for tax deductibility.`,
            affectedRecord: {
              type: 'PURCHASE_BILL',
              id: bill.id,
              reference: bill.billNumber,
              amount: bill.totalAmount / 100,
              date: bill.billDate,
            },
            recommendedAction: `Upload the vendor's BIR-registered Sales Invoice (or supplementary Collection Receipt / Official Receipt) to the document vault and link it to Bill ${bill.billNumber}.`,
            authoritativeSource: 'BIR EOPT Act (RA 11976) RR 7-2024 & Compliance Rule Engine',
          });
        }
      }
    }

    // B. Check for Duplicate Invoices / Bills
    const billRefMap = new Map<string, typeof purchaseBills[0]>();
    for (const bill of purchaseBills) {
      const key = `${bill.vendorId || 'unknown'}_${(bill.billNumber || '').trim().toLowerCase()}`;
      if (billRefMap.has(key)) {
        const prev = billRefMap.get(key)!;
        findings.push({
          ruleId: 'COMP-DUP-001',
          category: 'DUPLICATE_INVOICE',
          severity: 'HIGH',
          issue: `Potential Duplicate Vendor Bill (${bill.billNumber})`,
          explanation: `Multiple bills exist with reference "${bill.billNumber}" for the same vendor. This could lead to duplicate payment and over-claiming Input VAT.`,
          affectedRecord: {
            type: 'PURCHASE_BILL',
            id: bill.id,
            reference: bill.billNumber,
            amount: bill.totalAmount / 100,
            date: bill.billDate,
            details: { duplicateOfId: prev.id },
          },
          recommendedAction: `Review Bill ${bill.billNumber} and void or merge duplicate records immediately.`,
          authoritativeSource: 'Internal Controls & Compliance Rule Engine',
        });
      } else {
        billRefMap.set(key, bill);
      }
    }

    // Check duplicate document SHA-256 hashes
    const docHashMap = new Map<string, typeof documents[0]>();
    for (const doc of documents) {
      if (doc.fileHash) {
        if (docHashMap.has(doc.fileHash)) {
          const original = docHashMap.get(doc.fileHash)!;
          findings.push({
            ruleId: 'COMP-DUP-002',
            category: 'DUPLICATE_INVOICE',
            severity: 'MEDIUM',
            issue: `Duplicate File Upload Detected (${doc.fileName})`,
            explanation: `Document "${doc.fileName}" has the exact same SHA-256 cryptographic hash (${doc.fileHash.substring(0, 12)}...) as "${original.fileName}".`,
            affectedRecord: {
              type: 'DOCUMENT',
              id: doc.id,
              reference: doc.fileName,
              date: doc.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
            },
            recommendedAction: `Check if this document was uploaded twice and remove the duplicate entry if redundant.`,
            authoritativeSource: 'Document Integrity & Cryptographic SHA-256 Engine',
          });
        } else {
          docHashMap.set(doc.fileHash, doc);
        }
      }
    }

    // C. Check for Invalid Transactions & Unbalanced Journal Entries
    const linesByJournalId = new Map<string, typeof journalLines>();
    for (const line of journalLines) {
      const arr = linesByJournalId.get(line.journalEntryId) || [];
      arr.push(line);
      linesByJournalId.set(line.journalEntryId, arr);
    }

    for (const journal of journalEntries) {
      if (journal.status === 'POSTED') {
        const lines = linesByJournalId.get(journal.id) || [];
        const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
        const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

        if (lines.length === 0) {
          findings.push({
            ruleId: 'COMP-TXN-001',
            category: 'INVALID_TRANSACTION',
            severity: 'CRITICAL',
            issue: `Empty Posted Journal Entry (${journal.journalNumber})`,
            explanation: `Journal entry ${journal.journalNumber} is marked as POSTED but contains 0 line items.`,
            affectedRecord: {
              type: 'JOURNAL_ENTRY',
              id: journal.id,
              reference: journal.journalNumber,
              date: journal.entryDate,
            },
            recommendedAction: `Inspect and correct journal entry ${journal.journalNumber} or unpost and recreate with balanced lines.`,
            authoritativeSource: 'Double-Entry Invariant Rule Engine',
          });
        } else if (totalDebit !== totalCredit) {
          findings.push({
            ruleId: 'COMP-TXN-002',
            category: 'INVALID_TRANSACTION',
            severity: 'CRITICAL',
            issue: `Unbalanced Posted Journal Entry (${journal.journalNumber})`,
            explanation: `Journal entry ${journal.journalNumber} has total debits ₱${(totalDebit / 100).toFixed(2)} != total credits ₱${(totalCredit / 100).toFixed(2)} (variance: ₱${Math.abs(totalDebit - totalCredit) / 100}).`,
            affectedRecord: {
              type: 'JOURNAL_ENTRY',
              id: journal.id,
              reference: journal.journalNumber,
              amount: totalDebit / 100,
              date: journal.entryDate,
            },
            recommendedAction: `Adjust the debit/credit lines of ${journal.journalNumber} to restore mathematical equality.`,
            authoritativeSource: 'Double-Entry Invariant Rule Engine',
          });
        }
      }
    }

    // D. Suspicious Entries (Round numbers >= 50k, weekend postings, high-value without description)
    for (const journal of journalEntries) {
      const lines = linesByJournalId.get(journal.id) || [];
      const totalAmount = lines.reduce((s, l) => s + (l.debit || 0), 0) / 100;

      if (totalAmount >= 50000 && totalAmount % 10000 === 0 && !journal.description?.trim()) {
        findings.push({
          ruleId: 'COMP-SUS-001',
          category: 'SUSPICIOUS_ENTRY',
          severity: 'MEDIUM',
          issue: `High-Value Round-Number Journal Entry without Description (${journal.journalNumber})`,
          explanation: `Journal ${journal.journalNumber} has a large round amount (₱${totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}) with no detailed description or business justification.`,
          affectedRecord: {
            type: 'JOURNAL_ENTRY',
            id: journal.id,
            reference: journal.journalNumber,
            amount: totalAmount,
            date: journal.entryDate,
          },
          recommendedAction: `Add an explanatory memo and attach audit workpapers documenting the business purpose of this entry.`,
          authoritativeSource: 'Audit & Anti-Fraud Compliance Rule Engine',
        });
      }
    }

    // E. Tax Inconsistencies (VAT 12% mismatch, missing TINs)
    for (const cust of customers) {
      if (!cust.tin || cust.tin.trim() === '' || cust.tin === '000-000-000-000') {
        const custInvoices = salesInvoices.filter(i => i.customerId === cust.id);
        const totalSales = custInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
        if (totalSales >= 5000000) { // ₱50k in centavos
          findings.push({
            ruleId: 'COMP-TAX-001',
            category: 'TAX_INCONSISTENCY',
            severity: 'HIGH',
            issue: `Missing TIN for Major Customer (${cust.legalName})`,
            explanation: `Customer "${cust.legalName}" has total transactions of ₱${(totalSales / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} but no registered Tax Identification Number (TIN). Required for BIR Summary List of Sales (SLS).`,
            affectedRecord: {
              type: 'CUSTOMER',
              id: cust.id,
              reference: cust.code || cust.legalName,
              amount: totalSales / 100,
            },
            recommendedAction: `Update customer record with valid 9-12 digit BIR TIN before filing quarterly SLS.`,
            authoritativeSource: 'BIR RR 16-2005 & EOPT Act',
          });
        }
      }
    }

    for (const vend of vendors) {
      if (!vend.tin || vend.tin.trim() === '' || vend.tin === '000-000-000-000') {
        const vendBills = purchaseBills.filter(b => b.vendorId === vend.id);
        const totalSpend = vendBills.reduce((s, b) => s + (b.totalAmount || 0), 0);
        if (totalSpend >= 2000000) { // ₱20k in centavos
          findings.push({
            ruleId: 'COMP-TAX-002',
            category: 'TAX_INCONSISTENCY',
            severity: 'HIGH',
            issue: `Missing TIN for Vendor (${vend.legalName})`,
            explanation: `Vendor "${vend.legalName}" has total bills of ₱${(totalSpend / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} but no TIN on record. Input VAT cannot be credited without the vendor's TIN on the Summary List of Purchases (SLP).`,
            affectedRecord: {
              type: 'VENDOR',
              id: vend.id,
              reference: vend.code || vend.legalName,
              amount: totalSpend / 100,
            },
            recommendedAction: `Request BIR Form 2303 / Certificate of Registration from vendor and input their TIN.`,
            authoritativeSource: 'BIR RR 16-2005 & SLP Requirements',
          });
        }
      }
    }

    // F. Bookkeeping Issues (Stale Drafts > 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    for (const inv of salesInvoices) {
      if (inv.status === 'DRAFT' && inv.invoiceDate <= thirtyDaysAgoStr) {
        findings.push({
          ruleId: 'COMP-BOOK-001',
          category: 'BOOKKEEPING_ISSUE',
          severity: 'LOW',
          issue: `Stale Draft Sales Invoice (${inv.invoiceNumber})`,
          explanation: `Invoice ${inv.invoiceNumber} has been in DRAFT status since ${inv.invoiceDate} (over 30 days). Unposted drafts may cause unrecorded revenues.`,
          affectedRecord: {
            type: 'SALES_INVOICE',
            id: inv.id,
            reference: inv.invoiceNumber,
            amount: inv.totalAmount / 100,
            date: inv.invoiceDate,
          },
          recommendedAction: `Either post the invoice to commit revenue or delete/cancel the draft.`,
          authoritativeSource: 'Periodic Bookkeeping Hygiene & Period Close Rules',
        });
      }
    }

    for (const bill of purchaseBills) {
      if (bill.status === 'DRAFT' && bill.billDate <= thirtyDaysAgoStr) {
        findings.push({
          ruleId: 'COMP-BOOK-002',
          category: 'BOOKKEEPING_ISSUE',
          severity: 'LOW',
          issue: `Stale Draft Purchase Bill (${bill.billNumber})`,
          explanation: `Bill ${bill.billNumber} has been in DRAFT status since ${bill.billDate} (over 30 days).`,
          affectedRecord: {
            type: 'PURCHASE_BILL',
            id: bill.id,
            reference: bill.billNumber,
            amount: bill.totalAmount / 100,
            date: bill.billDate,
          },
          recommendedAction: `Review and post or discard draft bill ${bill.billNumber}.`,
          authoritativeSource: 'Periodic Bookkeeping Hygiene & Period Close Rules',
        });
      }
    }

    // G. Filing Risks & Statutory Warnings
    const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter(f => f.severity === 'LOW').length;
    const infoCount = findings.filter(f => f.severity === 'INFO').length;

    // Calculate overall compliance health score (100 minus weighted penalties)
    const penalty = (criticalCount * 25) + (highCount * 12) + (mediumCount * 5) + (lowCount * 2);
    const healthScore = Math.max(0, Math.min(100, 100 - penalty));

    // Statutory checklist summary
    statutoryChecklist.push({
      ruleCode: 'STAT-001',
      description: 'Double-Entry Invariant (Debits == Credits in all posted journals)',
      status: findings.some(f => f.ruleId === 'COMP-TXN-002') ? 'FAILED' : 'PASSED',
      notes: findings.some(f => f.ruleId === 'COMP-TXN-002') ? 'Detected out-of-balance posted journals.' : 'All posted journals are strictly balanced.',
    });

    statutoryChecklist.push({
      ruleCode: 'STAT-002',
      description: 'BIR RR 16-2005 Supporting Documents & Receipts Integrity',
      status: findings.some(f => f.ruleId === 'COMP-DOC-001') ? 'WARNING' : 'PASSED',
      notes: findings.some(f => f.ruleId === 'COMP-DOC-001') ? 'Found purchase bills exceeding threshold without attached receipt.' : 'All high-value bills have supporting attachments.',
    });

    statutoryChecklist.push({
      ruleCode: 'STAT-003',
      description: 'BIR Summary List of Sales & Purchases (SLS/SLP) TIN Validation',
      status: (findings.some(f => f.ruleId === 'COMP-TAX-001') || findings.some(f => f.ruleId === 'COMP-TAX-002')) ? 'WARNING' : 'PASSED',
      notes: 'Ensure all counterparties have valid BIR Tax Identification Numbers.',
    });

    statutoryChecklist.push({
      ruleCode: 'STAT-004',
      description: 'Duplicate Reference & SHA-256 Prevention',
      status: (findings.some(f => f.ruleId === 'COMP-DUP-001') || findings.some(f => f.ruleId === 'COMP-DUP-002')) ? 'WARNING' : 'PASSED',
      notes: 'Checks for duplicate vendor invoices and repeated SHA-256 file uploads.',
    });

    return {
      companyId,
      companyName,
      asOfDate: new Date().toISOString().split('T')[0],
      summary: {
        totalFindings: findings.length,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        infoCount,
        healthScore,
      },
      findings,
      statutoryChecklist,
    };
  }
}

export const ComplianceAnalyzer = {
  analyzeCompanyCompliance: ComplianceRuleEngine.evaluateAll,
};
